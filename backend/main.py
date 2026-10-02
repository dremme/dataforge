import asyncio
from contextlib import asynccontextmanager, suppress

from python_version import require_python

require_python()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before other modules read os.environ.
from env_file import load_env_file

load_env_file()

from api_errors import ApiError, api_error_handler
from automation.jobs import job_manager
from db import init_db
from external_jobs_feed import run_external_jobs_feed
from folder_watch import run_folder_watch_feed
from history_retention import run_history_retention
from logging_config import configure_logging
from routes import router
from server_settings import get_cors_origins
from static_site import mount_ui
from thumbnails import prune_thumbnail_cache

CORS_ORIGINS = get_cors_origins()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    init_db()
    job_manager.initialize()

    prune = asyncio.create_task(asyncio.to_thread(prune_thumbnail_cache))
    external_jobs = asyncio.create_task(run_external_jobs_feed())
    folder_watch = asyncio.create_task(run_folder_watch_feed())
    retention = asyncio.create_task(run_history_retention())

    try:
        yield
    finally:
        # Bound wait: prune walks the cache in a thread and cancel does not interrupt it.
        for task in (external_jobs, folder_watch, retention, prune):
            task.cancel()
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(
                asyncio.gather(
                    external_jobs, folder_watch, retention, prune, return_exceptions=True
                ),
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

app.add_exception_handler(ApiError, api_error_handler)
app.include_router(router)

# After the router: the mount answers "/" and everything below it.
mount_ui(app)
