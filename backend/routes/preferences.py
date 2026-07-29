from fastapi import APIRouter, Query

from body_parts_settings import get_body_parts_settings, update_body_parts_settings
from schemas import (
    BodyPartsSettingsResponse,
    BodyPartsSettingsUpdate,
    UiSettingsResponse,
    UiSettingsUpdate,
    VerifyCaptionsSettingsResponse,
    VerifyCaptionsSettingsUpdate,
)
from ui_settings import get_ui_settings, update_ui_settings
from verify_captions_settings import get_verify_captions_settings, update_verify_captions_settings

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


@router.get("/preferences/body-parts", response_model=BodyPartsSettingsResponse)
def read_body_parts_settings() -> BodyPartsSettingsResponse:
    return get_body_parts_settings()


@router.put("/preferences/body-parts", response_model=BodyPartsSettingsResponse)
def write_body_parts_settings(body: BodyPartsSettingsUpdate) -> BodyPartsSettingsResponse:
    return update_body_parts_settings(
        body_description=body.body_description,
        face_description=body.face_description,
        keywords=body.keywords,
        element_description=body.element_description,
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
