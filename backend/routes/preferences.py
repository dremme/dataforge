from fastapi import APIRouter

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
    settings = get_ui_settings()
    return UiSettingsResponse(
        sort=str(settings["sort"]),
        show_automation_specs=bool(settings["show_automation_specs"]),
    )


@router.put("/preferences/ui", response_model=UiSettingsResponse)
def write_ui_settings(body: UiSettingsUpdate) -> UiSettingsResponse:
    settings = update_ui_settings(
        sort=body.sort,
        show_automation_specs=body.show_automation_specs,
    )
    return UiSettingsResponse(
        sort=str(settings["sort"]),
        show_automation_specs=bool(settings["show_automation_specs"]),
    )


@router.get("/preferences/body-parts", response_model=BodyPartsSettingsResponse)
def read_body_parts_settings() -> BodyPartsSettingsResponse:
    settings = get_body_parts_settings()
    return BodyPartsSettingsResponse(
        body_description=settings["body_description"],
        face_description=settings["face_description"],
        keywords=settings["keywords"],
        element_description=settings["element_description"],
    )


@router.put("/preferences/body-parts", response_model=BodyPartsSettingsResponse)
def write_body_parts_settings(body: BodyPartsSettingsUpdate) -> BodyPartsSettingsResponse:
    settings = update_body_parts_settings(
        body_description=body.body_description,
        face_description=body.face_description,
        keywords=body.keywords,
        element_description=body.element_description,
    )
    return BodyPartsSettingsResponse(
        body_description=settings["body_description"],
        face_description=settings["face_description"],
        keywords=settings["keywords"],
        element_description=settings["element_description"],
    )


@router.get("/preferences/verify-captions", response_model=VerifyCaptionsSettingsResponse)
def read_verify_captions_settings() -> VerifyCaptionsSettingsResponse:
    settings = get_verify_captions_settings()
    return VerifyCaptionsSettingsResponse(
        mode=settings["mode"],  # type: ignore[arg-type]
        context=settings["context"],
    )


@router.put("/preferences/verify-captions", response_model=VerifyCaptionsSettingsResponse)
def write_verify_captions_settings(
    body: VerifyCaptionsSettingsUpdate,
) -> VerifyCaptionsSettingsResponse:
    settings = update_verify_captions_settings(
        mode=body.mode,
        context=body.context,
    )
    return VerifyCaptionsSettingsResponse(
        mode=settings["mode"],  # type: ignore[arg-type]
        context=settings["context"],
    )
