from typing import Literal

from pydantic import BaseModel, Field


class Breadcrumb(BaseModel):
    name: str
    path: str


class Subfolder(BaseModel):
    """A child folder card.

    The counts are ``None`` in a ``/api/browse`` response: computing them means
    reading every caption sidecar in every child, so they are served separately
    by ``/api/browse/subfolder-stats`` and merged in once they arrive.
    """

    name: str
    path: str
    file_count: int | None = None
    captioned_count: int | None = None
    issue_count: int | None = None


class SubfolderStats(BaseModel):
    path: str
    file_count: int
    captioned_count: int
    issue_count: int = 0


class SubfolderStatsResponse(BaseModel):
    folder: str
    subfolders: list[SubfolderStats]


class CaptionBBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    type: str | None = None
    label: str | None = None


class GalleryItem(BaseModel):
    name: str
    path: str
    description: str | None
    has_description: bool
    has_caption_file: bool
    issue_fixes: list[str] = Field(default_factory=list)
    has_issue_file: bool = False
    has_bboxes: bool
    caption_status: str
    caption_file_type: str | None
    media_type: str
    width: int | None = None
    height: int | None = None
    frame_count: int | None = None
    fps: float | None = None
    size: int | None = None
    modified_at: str | None = None
    bboxes: list[CaptionBBox] | None = None


class BrowseFingerprintResponse(BaseModel):
    fingerprint: str


class BrowseResponse(BaseModel):
    folder: str
    home: str
    parent: str | None
    breadcrumbs: list[Breadcrumb]
    subfolders: list[Subfolder]
    items: list[GalleryItem]
    sysprompt: GalleryItem | None = None
    has_caption_backup: bool = False
    item_count: int
    subfolder_count: int
    fingerprint: str = ""


class HealthResponse(BaseModel):
    status: str = "ok"


class SystemSpecsResponse(BaseModel):
    cpu_name: str
    cpu_cores: int
    memory_total_bytes: int
    memory_used_bytes: int
    gpu_name: str | None = None
    gpu_memory_bytes: int | None = None
    gpu_memory_used_bytes: int | None = None
    gpu_available: bool = False


class VisionLlmInfoResponse(BaseModel):
    model: str


GallerySort = Literal[
    "name-asc",
    "name-desc",
    "date-asc",
    "date-desc",
    "caption-asc",
    "caption-desc",
    "megapixels-asc",
    "megapixels-desc",
]


class UiSettingsResponse(BaseModel):
    sort: GallerySort = "name-asc"
    show_automation_specs: bool = False


class UiSettingsUpdate(BaseModel):
    # Deliberately not ``GallerySort``: an unknown sort resets to the default
    # instead of failing the request.
    sort: str | None = None
    show_automation_specs: bool | None = None


class CaptionUpdate(BaseModel):
    text: str = ""
    bboxes: list[CaptionBBox] | None = None
    json_content: str | None = None
    resolve_issue: bool = False


class CaptionSaveResponse(BaseModel):
    description: str | None
    has_description: bool
    has_caption_file: bool
    caption_status: str
    caption_file: str = ""
    caption_file_type: str | None = None
    caption_content: str | None = None
    bboxes: list[CaptionBBox] = Field(default_factory=list)
    has_bboxes: bool
    issue_fixes: list[str] = Field(default_factory=list)
    has_issue_file: bool = False


class SysPromptSaveResponse(BaseModel):
    description: str | None
    has_description: bool
    has_caption_file: bool
    caption_status: str
    path: str


class JobSelectionRequest(BaseModel):
    paths: list[str] | None = Field(
        default=None,
        description="Optional absolute media paths to limit the job to. Omit to process the full folder.",
    )


class AutoCaptionStartRequest(JobSelectionRequest):
    mode: Literal["thinking", "instruct"] = "thinking"


class SetCaptionsStartRequest(JobSelectionRequest):
    caption: str = ""
    overwrite: bool = False


class BodyPartsSettingsResponse(BaseModel):
    body_description: str = ""
    face_description: str = ""
    keywords: str = ""
    element_description: str = ""


class BodyPartsSettingsUpdate(BaseModel):
    body_description: str | None = None
    face_description: str | None = None
    keywords: str | None = None
    element_description: str | None = None


class BodyPartsStartRequest(JobSelectionRequest):
    body_description: str = ""
    face_description: str = ""
    keywords: str = ""
    element_description: str = ""


class StripMetadataStartRequest(JobSelectionRequest):
    pass


class BatchRenameStartRequest(JobSelectionRequest):
    stem: str = ""


class BackupCaptionsStartRequest(JobSelectionRequest):
    pass


class RestoreCaptionsStartRequest(JobSelectionRequest):
    pass


class VerifyCaptionsSettingsResponse(BaseModel):
    mode: Literal["thinking", "instruct"] = "instruct"
    context: str = ""
    folder_path: str


class VerifyCaptionsSettingsUpdate(BaseModel):
    mode: Literal["thinking", "instruct"] | None = None
    context: str | None = None
    folder_path: str


class VerifyCaptionsStartRequest(JobSelectionRequest):
    mode: Literal["thinking", "instruct"] = "instruct"
    context: str = ""


class TrainLoraStartRequest(JobSelectionRequest):
    lora_name: str = ""
    trigger_word: str = ""
    prompts: list[str] = Field(default_factory=list)


class JobFileResult(BaseModel):
    path: str
    name: str
    status: str
    description: str | None = None
    preview: str | None = None
    message: str | None = None


class JobResponse(BaseModel):
    id: str
    folder: str
    folder_name: str = ""
    job_type: str = "auto_caption"
    status: str
    total: int
    processed: int
    current_file: str | None = None
    current_name: str | None = None
    stats: dict[str, int] = Field(default_factory=dict)
    results: list[JobFileResult] = Field(default_factory=list)
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    auto_caption_mode: str | None = None
    external_ref: str | None = None


class JobsResponse(BaseModel):
    jobs: list[JobResponse] = Field(default_factory=list)
    active_count: int = 0


class JobDeleteResponse(BaseModel):
    deleted_count: int


class ExternalOstrisJobResponse(BaseModel):
    id: str
    name: str
    status: str
    step: int = 0
    total_steps: int | None = None
    info: str | None = None
    speed_string: str | None = None
    job_type: str | None = None
    dataset_folder: str | None = None
    dataset_folder_name: str = ""
    model: str | None = None
    created_at: str | None = None
    save_now: bool = False
    stop_requested: bool = False


class ExternalOstrisJobsResponse(BaseModel):
    jobs: list[ExternalOstrisJobResponse] = Field(default_factory=list)
    active_count: int = 0
    available: bool = False


class ExternalOstrisJobStopResponse(BaseModel):
    success: bool
    message: str | None = None


class OstrisTrainingSample(BaseModel):
    path: str
    name: str
    step: int
    prompt: str | None = None


class OstrisTrainingSamplesResponse(BaseModel):
    samples: list[OstrisTrainingSample] = Field(default_factory=list)
    step: int | None = None
    available: bool = False


class FolderRoot(BaseModel):
    name: str
    path: str


class FolderRootsResponse(BaseModel):
    home: str
    roots: list[FolderRoot] = Field(default_factory=list)


class FolderChild(BaseModel):
    """Name + path only (no media/caption stats)."""

    name: str
    path: str


class FolderChildrenResponse(BaseModel):
    folder: str
    children: list[FolderChild] = Field(default_factory=list)


class FolderFavorite(BaseModel):
    name: str
    path: str


class FolderFavoritesResponse(BaseModel):
    favorites: list[FolderFavorite] = Field(default_factory=list)


class FolderOpenResponse(BaseModel):
    path: str


class FolderCreateResponse(BaseModel):
    name: str
    path: str
    file_count: int = 0
    captioned_count: int = 0
    issue_count: int = 0


class MediaOpenResponse(BaseModel):
    path: str


class PngWorkflowResponse(BaseModel):
    has_workflow: bool


class FileImportPreviewRequest(BaseModel):
    filenames: list[str] = Field(default_factory=list)


class FileImportPreviewResponse(BaseModel):
    importable: list[str] = Field(default_factory=list)
    new_files: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    rejected: list[str] = Field(default_factory=list)


class FileImportResponse(BaseModel):
    copied: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    rejected: list[str] = Field(default_factory=list)


class MediaDeleteResponse(BaseModel):
    path: str
    deleted: list[str] = Field(default_factory=list)


# Move and copy share these shapes: the request and the outcome are identical,
# only the endpoint decides whether the source survives.
class MediaTransferPreviewRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)


class MediaTransferPreviewResponse(BaseModel):
    eligible: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)


class MediaTransferRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)


class MediaTransferItemResponse(BaseModel):
    source: str
    destination: str
    files: list[str] = Field(default_factory=list)


class MediaTransferFailure(BaseModel):
    path: str
    detail: str


class MediaTransferResponse(BaseModel):
    transferred: list[MediaTransferItemResponse] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    failed: list[MediaTransferFailure] = Field(default_factory=list)
