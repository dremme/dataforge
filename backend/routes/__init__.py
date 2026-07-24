from fastapi import APIRouter

from routes import (
    automation,
    browse,
    captions,
    external_jobs,
    files,
    folders,
    health,
    jobs,
    media,
    preferences,
    system,
)

router = APIRouter(prefix="/api")

for module in (
    automation,
    health,
    system,
    folders,
    browse,
    media,
    captions,
    files,
    preferences,
    jobs,
    external_jobs,
):
    router.include_router(module.router)
