from fastapi import APIRouter, BackgroundTasks, HTTPException

from app_settings import InvalidSettingError, describe_app_settings, update_app_settings
from history_retention import prune_history
from schemas import (
    AppSettingsResponse,
    AppSettingsUpdate,
    ServiceProbeRequest,
    ServiceProbeResponse,
    ThumbnailCacheCleared,
    ThumbnailCacheStats,
)
from service_probe import probe_service
from thumbnails import clear_thumbnail_cache, thumbnail_cache_stats

_RETENTION_KEYS = frozenset({"job_history_days", "notification_history_days"})

router = APIRouter()


@router.get("/settings", response_model=AppSettingsResponse)
def read_app_settings() -> AppSettingsResponse:
    return describe_app_settings()


@router.put("/settings", response_model=AppSettingsResponse)
def write_app_settings(body: AppSettingsUpdate, tasks: BackgroundTasks) -> AppSettingsResponse:
    try:
        settings = update_app_settings(body)
    except InvalidSettingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if _RETENTION_KEYS & (body.model_fields_set | set(body.reset)):
        tasks.add_task(prune_history)
    return settings


@router.post("/settings/probe", response_model=ServiceProbeResponse)
def probe_settings_service(body: ServiceProbeRequest) -> ServiceProbeResponse:
    try:
        return probe_service(body)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"URL {error}.") from error


@router.get("/thumbnails/cache", response_model=ThumbnailCacheStats)
def read_thumbnail_cache() -> ThumbnailCacheStats:
    return thumbnail_cache_stats()


@router.delete("/thumbnails/cache", response_model=ThumbnailCacheCleared)
def delete_thumbnail_cache() -> ThumbnailCacheCleared:
    return clear_thumbnail_cache()
