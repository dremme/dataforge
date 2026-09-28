from fastapi import APIRouter, HTTPException

from app_settings import InvalidSettingError, describe_app_settings, update_app_settings
from schemas import (
    AppSettingsResponse,
    AppSettingsUpdate,
    ThumbnailCacheCleared,
    ThumbnailCacheStats,
)
from thumbnails import clear_thumbnail_cache, thumbnail_cache_stats

router = APIRouter()


@router.get("/settings", response_model=AppSettingsResponse)
def read_app_settings() -> AppSettingsResponse:
    return describe_app_settings()


@router.put("/settings", response_model=AppSettingsResponse)
def write_app_settings(body: AppSettingsUpdate) -> AppSettingsResponse:
    try:
        return update_app_settings(body)
    except InvalidSettingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/thumbnails/cache", response_model=ThumbnailCacheStats)
def read_thumbnail_cache() -> ThumbnailCacheStats:
    return thumbnail_cache_stats()


@router.delete("/thumbnails/cache", response_model=ThumbnailCacheCleared)
def delete_thumbnail_cache() -> ThumbnailCacheCleared:
    return clear_thumbnail_cache()
