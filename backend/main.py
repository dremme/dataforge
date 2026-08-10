import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load project .env before other modules read os.environ.
from env_file import load_env_file

load_env_file()

from automation.jobs import job_manager
from db import init_db
from external_jobs_feed import run_external_jobs_feed
from folder_watch import run_folder_watch_feed
from logging_config import configure_logging
from routes import router
from server_settings import get_cors_origins
from thumbnails import prune_thumbnail_cache

CORS_ORIGINS = get_cors_origins()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    init_db()
    job_manager.initialize()

    # Reclaims what jobs that rewrote media orphaned since the last run. Off the
    # startup path, since nothing waits on it and it walks the whole cache tree.
    prune = asyncio.create_task(asyncio.to_thread(prune_thumbnail_cache))
    external_jobs = asyncio.create_task(run_external_jobs_feed())
    folder_watch = asyncio.create_task(run_folder_watch_feed())

    try:
        yield
    finally:
        # Bound wait: prune walks the whole cache tree in a thread, and cancel
        # does not interrupt it. Awaiting forever would pad every reload/exit
        # after open SSE/media connections have already been cut off.
        for task in (external_jobs, folder_watch, prune):
            task.cancel()
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(
                asyncio.gather(external_jobs, folder_watch, prune, return_exceptions=True),
                timeout=1.0,
            )


app = FastAPI(title="DataForge API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
