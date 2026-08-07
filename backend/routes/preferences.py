from fastapi import APIRouter, Query

from schemas import (
    UiSettingsResponse,
    UiSettingsUpdate,
    VerifyCaptionsSettingsResponse,
    VerifyCaptionsSettingsUpdate,
    WatermarkSettingsResponse,
    WatermarkSettingsUpdate,
)
from ui_settings import get_ui_settings, update_ui_settings
from verify_captions_settings import get_verify_captions_settings, update_verify_captions_settings
from watermark_settings import get_watermark_settings, update_watermark_settings

router = APIRouter()


@router.get("/preferences/ui", response_model=UiSettingsResponse)
def read_ui_settings() -> UiSettingsResponse:
    return get_ui_settings()


@router.put("/preferences/ui", response_model=UiSettingsResponse)
def write_ui_settings(body: UiSettingsUpdate) -> UiSettingsResponse:
    return update_ui_settings(
        sort=body.sort,
        show_automation_specs=body.show_automation_specs,
    )


@router.get("/preferences/verify-captions", response_model=VerifyCaptionsSettingsResponse)
def read_verify_captions_settings(
    path: str = Query(..., description="Folder path; context is returned for this folder"),
) -> VerifyCaptionsSettingsResponse:
    return get_verify_captions_settings(folder_path=path)


@router.put("/preferences/verify-captions", response_model=VerifyCaptionsSettingsResponse)
def write_verify_captions_settings(
    body: VerifyCaptionsSettingsUpdate,
) -> VerifyCaptionsSettingsResponse:
    return update_verify_captions_settings(
        mode=body.mode,
        context=body.context,
        folder_path=body.folder_path,
    )


@router.get("/preferences/watermark", response_model=WatermarkSettingsResponse)
def read_watermark_settings() -> WatermarkSettingsResponse:
    return get_watermark_settings()


@router.put("/preferences/watermark", response_model=WatermarkSettingsResponse)
def write_watermark_settings(body: WatermarkSettingsUpdate) -> WatermarkSettingsResponse:
    return update_watermark_settings(
        text=body.text, size=body.size, opacity=body.opacity, position=body.position
    )
