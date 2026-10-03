from fastapi import APIRouter, Query

import automation_settings
import gallery_display_settings
from automation_settings import get_automation_settings
from gallery_display_settings import (
    get_gallery_display_settings,
    update_gallery_display_settings,
)
from schemas import (
    AutomationSettingsResponse,
    GalleryDisplaySettingsResponse,
    GalleryDisplaySettingsUpdate,
    RememberedDataResponse,
    UiSettingsResponse,
    UiSettingsUpdate,
)
from ui_settings import get_ui_settings, update_ui_settings

router = APIRouter()


@router.get("/preferences/ui", response_model=UiSettingsResponse)
def read_ui_settings() -> UiSettingsResponse:
    return get_ui_settings()


@router.put("/preferences/ui", response_model=UiSettingsResponse)
def write_ui_settings(body: UiSettingsUpdate) -> UiSettingsResponse:
    return update_ui_settings(
        sort=body.sort,
        show_automation_specs=body.show_automation_specs,
        theme=body.theme,
        keep_candidate_metadata=body.keep_candidate_metadata,
    )


@router.get("/preferences/gallery-display", response_model=GalleryDisplaySettingsResponse)
def read_gallery_display_settings(
    path: str = Query(..., description="Folder path; the display mode is returned for this folder"),
) -> GalleryDisplaySettingsResponse:
    return get_gallery_display_settings(folder_path=path)


@router.put("/preferences/gallery-display", response_model=GalleryDisplaySettingsResponse)
def write_gallery_display_settings(
    body: GalleryDisplaySettingsUpdate,
) -> GalleryDisplaySettingsResponse:
    return update_gallery_display_settings(mode=body.mode, folder_path=body.folder_path)


@router.get("/preferences/automation", response_model=AutomationSettingsResponse)
def read_automation_settings(
    path: str = Query(..., description="Folder path; each job's settings are returned for it"),
) -> AutomationSettingsResponse:
    """Read-only on purpose: settings are stored by the job-start routes themselves."""
    return get_automation_settings(folder_path=path)


def _remembered() -> RememberedDataResponse:
    return RememberedDataResponse(
        job_option_folders=automation_settings.remembered_folder_count(),
        display_mode_folders=gallery_display_settings.remembered_folder_count(),
    )


@router.get("/preferences/remembered", response_model=RememberedDataResponse)
def read_remembered_data() -> RememberedDataResponse:
    return _remembered()


@router.delete("/preferences/remembered/job-options", response_model=RememberedDataResponse)
def forget_job_options() -> RememberedDataResponse:
    automation_settings.forget_folder_settings()
    return _remembered()


@router.delete("/preferences/remembered/display-modes", response_model=RememberedDataResponse)
def forget_display_modes() -> RememberedDataResponse:
    gallery_display_settings.forget_folder_modes()
    return _remembered()
