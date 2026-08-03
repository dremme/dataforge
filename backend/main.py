from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load project .env before other modules read os.environ.
from env_file import load_env_file

load_env_file()

from automation.jobs import job_manager
from db import init_db
from logging_config import configure_logging
from routes import router

CORS_ORIGINS = ("http://localhost:8081", "http://127.0.0.1:8081")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    init_db()
    job_manager.initialize()

    yield


app = FastAPI(title="DataForge API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
