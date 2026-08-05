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

    try:
        yield
    finally:
        for task in (external_jobs, prune):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="DataForge API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
