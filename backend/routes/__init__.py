from fastapi import APIRouter

from routes import (
    automation,
    captions,
    duplicates,
    events,
    external_jobs,
    files,
    folder_contents,
    folders,
    health,
    jobs,
    media,
    notifications,
    preferences,
    sidecars,
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
    duplicates,
    sidecars,
    files,
    notifications,
    preferences,
    jobs,
    external_jobs,
    events,
):
    router.include_router(module.router)
