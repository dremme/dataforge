from fastapi import APIRouter

from routes import (
    automation,
    captions,
    events,
    external_jobs,
    files,
    folder_contents,
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
    folder_contents,
    media,
    captions,
    files,
    preferences,
    jobs,
    external_jobs,
    events,
):
    router.include_router(module.router)
