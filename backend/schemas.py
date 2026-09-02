from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

# PEP 695 ``type`` aliases so pydantic emits named schemas, which become TS unions.

#: ``no_caption`` is a job stat key, not one of these.
type CaptionStatus = Literal["none", "empty", "text"]

#: GIF is its own type so it renders as ``<img>``; a sysprompt is listed as media too.
type MediaType = Literal["image", "video", "gif", "sysprompt"]

type WatermarkSizeName = Literal["small", "medium", "large"]
type WatermarkOpacity = Literal[25, 50, 75]
# Annotated so the note reaches generated TypeScript; a ``#:`` comment does not.
type WatermarkPosition = Annotated[
    Literal["top", "center", "bottom"],
    Field(description="top = top-left, center = middle, bottom = bottom-right."),
]

type AutomationMode = Literal["thinking", "instruct"]

#: Which sampler input a workflow's text reached; anything not named negative counts as positive.
type ComfyPromptRole = Literal["positive", "negative"]

#: Keys of ``TRAINING_TEMPLATES``; ``h3_*`` are video, ``krea2_turbo`` is image.
type TrainingModel = Literal["krea2_turbo", "h3_fl2va", "h3_ref2va"]

#: Chat template set; there is no ``high``. Template default ``xhigh``, ours ``medium``.
type ReasoningEffort = Literal["low", "medium", "xhigh"]

type JobStatus = Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"]
type JobType = Literal[
    "auto_caption",
    "strip_metadata",
    "set_captions",
    "replace_captions",
    "find_duplicates",
    "verify_captions",
    "edit_captions",
    "batch_rename",
    "backup_captions",
    "restore_captions",
    "train_lora",
    "watermark",
    "comfy_process",
]

#: ``prepend`` and ``append`` ignore the search term.
type CaptionReplaceMode = Literal["replace", "prepend", "append"]

#: Named rather than a raw distance so the wire does not depend on hash width.
type DuplicateThreshold = Literal["exact", "near", "loose"]

#: The suffix never crosses the wire; the backend resolves the filename.
type SidecarKind = Literal["issue", "duplicate"]


class Breadcrumb(BaseModel):
    name: str
    path: str


class Subfolder(BaseModel):
    """Counts are ``None`` on ``/api/folders/contents``; they arrive from ``/api/folders/subfolder-stats``."""

    name: str
    path: str
    file_count: int | None = None
    captioned_count: int | None = None
    issue_count: int | None = None
    duplicate_count: int | None = None


class SubfolderStats(BaseModel):
    path: str
    file_count: int
    captioned_count: int
    issue_count: int = 0
    duplicate_count: int = 0


class SubfolderStatsResponse(BaseModel):
    folder: str
    subfolders: list[SubfolderStats]


class GalleryItem(BaseModel):
    name: str
    path: str
    description: str | None
    has_description: bool
    has_caption_file: bool
    issue_fixes: list[str] = Field(default_factory=list)
    has_issue_file: bool = False
    #: Group membership comes from ``/api/duplicates``, never from the item.
    duplicate_group: str | None = None
    has_duplicate_file: bool = False
    #: Staging is a child directory, so this is not answered from ``scan.files``.
    has_candidate: bool = False
    #: The staged filename, which differs from this item's whenever the source is not a PNG.
    candidate_name: str | None = None
    caption_status: CaptionStatus
    media_type: MediaType
    width: int | None = None
    height: int | None = None
    #: Empty for stills, GIFs, and non-MP4-family containers.
    duration: float | None = None
    size: int | None = None
    modified_at: str | None = None
    has_backup: bool = False


class DuplicateGroup(BaseModel):
    """Members are resolved from the folder on every request, not stored."""

    group: str
    #: 0 means identical after downscaling.
    max_distance: int
    threshold: str
    members: list[GalleryItem]


class DuplicateGroupsResponse(BaseModel):
    folder: str
    groups: list[DuplicateGroup]
    #: Sidecars whose group has no other member left.
    stale: list[str] = Field(default_factory=list)
    #: Required so a new route cannot omit the confirmation that guards an irreversible delete.
    deletes_to_trash: bool


class DuplicateResolveRequest(BaseModel):
    keep: str
    #: Deleted through the same path as any other media delete.
    discard: list[str]


class DuplicateResolveResponse(BaseModel):
    kept: str
    deleted: list[str]
    failed: list[str] = Field(default_factory=list)


class DuplicateDismissRequest(BaseModel):
    #: Findings are cleared and no media is touched.
    paths: list[str]


class DuplicateDismissResponse(BaseModel):
    cleared: list[str]
    failed: list[str] = Field(default_factory=list)


class SidecarDeleteRequest(BaseModel):
    folder: str
    kind: SidecarKind


class SidecarDeleteResponse(BaseModel):
    folder: str
    kind: SidecarKind
    #: Names, not paths.
    deleted: list[str]
    #: A locked file lands here rather than aborting the sweep.
    failed: list[str]
    deletes_to_trash: bool


class FolderFingerprintResponse(BaseModel):
    fingerprint: str


class FolderChangesResponse(BaseModel):
    """``full`` means refetch the whole folder; ``changed`` covers both new and edited items."""

    full: bool = False
    fingerprint: str
    changed: list[GalleryItem] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)


class FolderResponse(BaseModel):
    path: str
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


type GallerySort = Literal[
    "name-asc",
    "name-desc",
    "date-asc",
    "date-desc",
    "caption-asc",
    "caption-desc",
    "megapixels-asc",
    "megapixels-desc",
    "duration-asc",
    "duration-desc",
]


class UiSettingsResponse(BaseModel):
    sort: GallerySort = "name-asc"
    show_automation_specs: bool = False


class UiSettingsUpdate(BaseModel):
    # Deliberately not ``GallerySort``: an unknown sort resets to the default instead of failing.
    sort: str | None = None
    show_automation_specs: bool | None = None


type GalleryDisplayMode = Literal["large", "small", "list"]


class GalleryDisplaySettingsResponse(BaseModel):
    mode: GalleryDisplayMode = "large"
    folder_path: str


class GalleryDisplaySettingsUpdate(BaseModel):
    mode: GalleryDisplayMode | None = None
    folder_path: str


class CaptionUpdate(BaseModel):
    text: str = ""
    resolve_issue: bool = False


class CaptionSaveResponse(BaseModel):
    description: str | None
    has_description: bool
    has_caption_file: bool
    caption_status: CaptionStatus
    caption_file: str = ""
    issue_fixes: list[str] = Field(default_factory=list)
    has_issue_file: bool = False


class SysPromptSaveResponse(BaseModel):
    description: str | None
    has_description: bool
    has_caption_file: bool
    caption_status: CaptionStatus
    path: str


class JobSelectionRequest(BaseModel):
    paths: list[str] | None = Field(
        default=None,
        description="Optional absolute media paths to limit the job to. Omit to process the full folder.",
    )


# Each start request inherits its settings model; extra start-only fields are never stored.


class AutoCaptionJobSettings(BaseModel):
    mode: AutomationMode = "thinking"
    reasoning_effort: ReasoningEffort = "medium"
    preserve_thinking: bool = Field(
        default=True,
        description="Keep earlier assistant reasoning in the rendered prompt.",
    )
    caption_audio: bool = Field(
        default=False,
        description="Send each clip's audio track with its keyframes. Needs an omni model.",
    )


class AutoCaptionStartRequest(JobSelectionRequest, AutoCaptionJobSettings):
    pass


class SetCaptionsJobSettings(BaseModel):
    caption: str = ""


class SetCaptionsStartRequest(JobSelectionRequest, SetCaptionsJobSettings):
    # Never remembered: overwriting must be re-chosen every run.
    overwrite: bool = False


class ReplaceCaptionsJobSettings(BaseModel):
    """``search`` and the flags are unconstrained so a refusal is the job's own 400, not a pydantic blob."""

    mode: CaptionReplaceMode = "replace"
    search: str = ""
    replacement: str = ""
    use_regex: bool = False
    case_sensitive: bool = False


class ReplaceCaptionsStartRequest(JobSelectionRequest, ReplaceCaptionsJobSettings):
    pass


class ReplaceCaptionsPreviewRequest(JobSelectionRequest, ReplaceCaptionsJobSettings):
    pass


class CaptionReplacePreviewSample(BaseModel):
    name: str
    before: str
    after: str


class ReplaceCaptionsPreviewResponse(BaseModel):
    """``error`` is inline rather than a 400 so the dialog can show it while typing."""

    folder: str
    total: int = 0
    matched: int = 0
    samples: list[CaptionReplacePreviewSample] = Field(default_factory=list)
    error: str | None = None


class FindDuplicatesJobSettings(BaseModel):
    threshold: DuplicateThreshold = "near"


class FindDuplicatesStartRequest(JobSelectionRequest, FindDuplicatesJobSettings):
    pass


class StripMetadataStartRequest(JobSelectionRequest):
    pass


class BatchRenameJobSettings(BaseModel):
    stem: str = ""
    # Unconstrained so an out-of-range number is the job's own 400.
    start_number: int = 1


class BatchRenameStartRequest(JobSelectionRequest, BatchRenameJobSettings):
    pass


class BackupCaptionsJobSettings(BaseModel):
    """``overwrite`` is never remembered; registered so every dialog job travels the same path."""


class BackupCaptionsStartRequest(JobSelectionRequest, BackupCaptionsJobSettings):
    # Never remembered: replacing existing backups must be re-chosen every run.
    overwrite: bool = Field(
        default=False,
        description="Replace sidecars already in the backup folder instead of keeping them.",
    )


class RestoreCaptionsStartRequest(JobSelectionRequest):
    pass


class WatermarkJobSettings(BaseModel):
    # Unconstrained so refusal is the job's own 400.
    text: str = ""
    size: WatermarkSizeName = "medium"
    opacity: WatermarkOpacity = 50
    position: WatermarkPosition = "bottom"
    #: Off by default: the marked copy keeps the original's metadata unless asked otherwise.
    strip_metadata: bool = Field(
        default=False,
        description="Remove EXIF and container metadata from the watermarked copies.",
    )


class WatermarkStartRequest(JobSelectionRequest, WatermarkJobSettings):
    pass


class ComfyProcessJobSettings(BaseModel):
    #: A stem, not a Literal: unknown names are the job's own 400.
    preset: str = ""
    #: Empty runs the preset's own seeds.
    seed: int | None = None
    #: Named ``prompt_text`` because ``prompt`` is the whole graph elsewhere.
    prompt_text: str = ""
    #: Off by default so a re-run picks up where the last stopped.
    overwrite_candidates: bool = False


class ComfyProcessStartRequest(JobSelectionRequest, ComfyProcessJobSettings):
    pass


class ComfyPresetSummary(BaseModel):
    name: str
    modified_at: str | None = None


class ComfyPresetTextResponse(BaseModel):
    name: str
    #: Not named ``json``: that shadows pydantic's BaseModel.
    content: str = Field(description="The preset exactly as exported from ComfyUI.")


class ComfyPresetsResponse(BaseModel):
    presets: list[ComfyPresetSummary] = Field(default_factory=list)
    #: A job may still queue while this is False.
    available: bool = False
    #: Sent even when available so the dialog can name the origin that was probed.
    base_url: str = ""


class VerifyCaptionsJobSettings(BaseModel):
    mode: AutomationMode = "instruct"
    reasoning_effort: ReasoningEffort = "medium"
    preserve_thinking: bool = Field(
        default=True,
        description="Keep earlier assistant reasoning in the rendered prompt.",
    )
    context: str = ""


class VerifyCaptionsStartRequest(JobSelectionRequest, VerifyCaptionsJobSettings):
    pass


class EditCaptionsJobSettings(BaseModel):
    mode: AutomationMode = "instruct"
    reasoning_effort: ReasoningEffort = "medium"
    preserve_thinking: bool = Field(
        default=True,
        description="Keep earlier assistant reasoning in the rendered prompt.",
    )
    #: Unconstrained so an empty instruction is the job's own 400.
    instruction: str = ""


class EditCaptionsStartRequest(JobSelectionRequest, EditCaptionsJobSettings):
    # Never remembered: persisting it would make "no backup" sticky.
    backup: bool = Field(
        default=True,
        description="Copy each caption into .backup before overwriting it.",
    )


class TrainLoraJobSettings(BaseModel):
    trigger_word: str = ""
    prompts: list[str] = Field(default_factory=list)
    model: TrainingModel = "krea2_turbo"


class TrainLoraStartRequest(JobSelectionRequest, TrainLoraJobSettings):
    # Never remembered: it is the resume key.
    lora_name: str = ""
    # Never remembered: a per-run override kept in memory only.
    template: str | None = Field(
        default=None,
        description=(
            "Edited template YAML to use for this run only. Omit to use the shipped "
            "template for the chosen model."
        ),
    )


class AutomationSettingsResponse(BaseModel):
    """Each field is named after its job type."""

    folder_path: str
    auto_caption: AutoCaptionJobSettings = Field(default_factory=AutoCaptionJobSettings)
    set_captions: SetCaptionsJobSettings = Field(default_factory=SetCaptionsJobSettings)
    replace_captions: ReplaceCaptionsJobSettings = Field(default_factory=ReplaceCaptionsJobSettings)
    backup_captions: BackupCaptionsJobSettings = Field(default_factory=BackupCaptionsJobSettings)
    verify_captions: VerifyCaptionsJobSettings = Field(default_factory=VerifyCaptionsJobSettings)
    edit_captions: EditCaptionsJobSettings = Field(default_factory=EditCaptionsJobSettings)
    batch_rename: BatchRenameJobSettings = Field(default_factory=BatchRenameJobSettings)
    find_duplicates: FindDuplicatesJobSettings = Field(default_factory=FindDuplicatesJobSettings)
    train_lora: TrainLoraJobSettings = Field(default_factory=TrainLoraJobSettings)
    watermark: WatermarkJobSettings = Field(default_factory=WatermarkJobSettings)
    comfy_process: ComfyProcessJobSettings = Field(default_factory=ComfyProcessJobSettings)


class TrainingTemplateResponse(BaseModel):
    model: TrainingModel
    yaml: str = Field(
        description="The template exactly as shipped, comments and placeholders intact."
    )


class TrainingTemplateCheckRequest(BaseModel):
    template: str


class TrainingTemplateCheckResponse(BaseModel):
    ok: bool
    error: str | None = None


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
    # Not ``JobType``/``JobStatus``: persisted rows can hold types this build no longer defines.
    job_type: str = "auto_caption"
    status: str
    total: int
    processed: int
    current_file: str | None = None
    current_name: str | None = None
    stats: dict[str, int] = Field(default_factory=dict)
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    auto_caption_mode: str | None = None
    external_ref: str | None = Field(
        default=None,
        description="The external job this one co-tracks (the AI-Toolkit training name).",
    )


class JobResultsResponse(BaseModel):
    """Served separately because a finished run over a large folder is megabytes."""

    job_id: str
    results: list[JobFileResult] = Field(default_factory=list)


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
    prompt: str = ""


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


class ComfyPromptText(BaseModel):
    role: ComfyPromptRole
    text: str
    node_id: str
    node_title: str | None = None
    input_name: str


class ComfyParameter(BaseModel):
    label: str
    value: str


class ComfyOutputBranch(BaseModel):
    """One saved result of the workflow, named by the subgraph that fed it."""

    node_id: str
    class_type: str
    label: str
    filename_prefix: str | None = None
    is_preview: bool = False
    matches_filename: bool = False
    prompts: list[ComfyPromptText] = Field(default_factory=list)
    parameters: list[ComfyParameter] = Field(default_factory=list)
    loras: list[str] = Field(default_factory=list)


class ComfyWorkflowPromptsResponse(BaseModel):
    """``matched_node_id`` is set only when exactly one branch claims the filename."""

    has_workflow: bool
    branches: list[ComfyOutputBranch] = Field(default_factory=list)
    matched_node_id: str | None = None
    orphan_prompts: list[ComfyPromptText] = Field(default_factory=list)


class GifInfoResponse(BaseModel):
    """Counted on demand; kept off the listing because counting walks the whole animation."""

    frame_count: int


class GifToMp4StateResponse(BaseModel):
    """Read before conversion so a taken name becomes a prompt rather than a silent overwrite."""

    path: str
    target: str
    target_exists: bool


class GifToMp4Response(BaseModel):
    path: str
    size: int
    modified_at: str
    frame_rate: float


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


# Move and copy share these shapes; only the endpoint decides whether the source survives.
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


#: Speed is bounded by what a browser can preview through ``playbackRate``.
MIN_EDIT_SPEED = 0.25
MAX_EDIT_SPEED = 4.0
MIN_EDIT_SCALE = 0.05
#: 0 mutes by dropping the track; 2 is a safe boost before clipping gets ugly.
MIN_EDIT_VOLUME = 0.0
MAX_EDIT_VOLUME = 2.0
#: Brightness, contrast and saturation are multipliers: 1 unchanged, 0 blank, 2 doubled.
MIN_EDIT_COLOR = 0.0
MAX_EDIT_COLOR = 2.0
#: Warmth is a symmetric push: negative cools, positive warms.
MAX_EDIT_WARMTH = 1.0
MIN_TRIM_SECONDS = 0.1

#: Float noise from a normalized drag can push a full-width rect past 1.0.
CROP_BOUNDS_EPSILON = 1e-6

MAX_MASK_REGIONS = 24
MIN_MASK_STRENGTH = 0.02
MAX_MASK_STRENGTH = 0.5


class EditCropRect(BaseModel):
    """Fractions of the source frame so ffmpeg can use ``iw``/``ih`` without ffprobe."""

    x: float = Field(0.0, ge=0.0, lt=1.0)
    y: float = Field(0.0, ge=0.0, lt=1.0)
    width: float = Field(1.0, gt=0.0, le=1.0)
    height: float = Field(1.0, gt=0.0, le=1.0)


def validated_crop(crop: EditCropRect | None) -> EditCropRect | None:
    """A full-frame rect is ``None`` so identity detection cannot disagree across the wire."""
    if crop is None:
        return None

    if crop.x + crop.width > 1.0 + CROP_BOUNDS_EPSILON:
        raise ValueError("The crop reaches past the right edge of the frame")
    if crop.y + crop.height > 1.0 + CROP_BOUNDS_EPSILON:
        raise ValueError("The crop reaches past the bottom edge of the frame")

    if crop.x == 0.0 and crop.y == 0.0 and crop.width == 1.0 and crop.height == 1.0:
        return None

    return crop


class MaskRegion(EditCropRect):
    """One rectangle of the source frame to obscure, applied before the crop."""

    mode: Literal["blur", "pixelate", "blackout"] = "blur"
    #: Fraction of the region's shorter side, so one strength reads the same at any region size.
    strength: float = Field(0.12, ge=MIN_MASK_STRENGTH, le=MAX_MASK_STRENGTH)


def validated_masks(masks: list[MaskRegion]) -> list[MaskRegion]:
    """Unlike a crop, a full-frame region stands: obscuring the whole picture is a real request."""
    for mask in masks:
        if mask.x + mask.width > 1.0 + CROP_BOUNDS_EPSILON:
            raise ValueError("A blur region reaches past the right edge of the frame")
        if mask.y + mask.height > 1.0 + CROP_BOUNDS_EPSILON:
            raise ValueError("A blur region reaches past the bottom edge of the frame")

    return masks


class VideoEditSpec(BaseModel):
    """Always applied to the untouched original in a single pass; every field defaults to identity."""

    trim_start: float = Field(0.0, ge=0.0)
    #: ``None`` runs to the end, so the client need not be right about a duration of ``Infinity``.
    trim_end: float | None = Field(None, gt=0.0)
    masks: list[MaskRegion] = Field(default_factory=list, max_length=MAX_MASK_REGIONS)
    crop: EditCropRect | None = None
    speed: float = Field(1.0, ge=MIN_EDIT_SPEED, le=MAX_EDIT_SPEED)
    scale: float = Field(1.0, ge=MIN_EDIT_SCALE, le=1.0)
    #: Audio gain: 1 unchanged, 0 mutes (the track is dropped), up to 2 for a boost.
    volume: float = Field(1.0, ge=MIN_EDIT_VOLUME, le=MAX_EDIT_VOLUME)
    brightness: float = Field(1.0, ge=MIN_EDIT_COLOR, le=MAX_EDIT_COLOR)
    contrast: float = Field(1.0, ge=MIN_EDIT_COLOR, le=MAX_EDIT_COLOR)
    saturation: float = Field(1.0, ge=MIN_EDIT_COLOR, le=MAX_EDIT_COLOR)
    warmth: float = Field(0.0, ge=-MAX_EDIT_WARMTH, le=MAX_EDIT_WARMTH)
    hue: float = Field(0.0, ge=0.0, lt=360.0)

    @model_validator(mode="after")
    def _check(self) -> "VideoEditSpec":
        if self.trim_end is not None:
            if self.trim_end <= self.trim_start:
                raise ValueError("The trim end must come after the trim start")
            if self.trim_end - self.trim_start < MIN_TRIM_SECONDS:
                raise ValueError(f"A trim must keep at least {MIN_TRIM_SECONDS} seconds")

        self.crop = validated_crop(self.crop)
        self.masks = validated_masks(self.masks)

        return self


class VideoEditStateResponse(BaseModel):
    path: str
    has_backup: bool
    spec: VideoEditSpec | None


class VideoEditResponse(BaseModel):
    path: str
    size: int
    modified_at: str
    width: int | None = None
    height: int | None = None
    has_backup: bool


class ImageEditSpec(BaseModel):
    """Order is mask, crop, mirror, rotate, scale, color — shared with the frontend overlay."""

    masks: list[MaskRegion] = Field(default_factory=list, max_length=MAX_MASK_REGIONS)
    crop: EditCropRect | None = None
    mirror_h: bool = False
    mirror_v: bool = False
    #: Clockwise degrees, applied after the mirrors.
    rotate: Literal[0, 90, 180, 270] = 0
    #: Capped at 1: upscaling invents detail a caption would then describe.
    scale: float = Field(1.0, ge=MIN_EDIT_SCALE, le=1.0)
    #: Color adjustments, applied last as one matrix. Each defaults to leaving the pixel alone.
    brightness: float = Field(1.0, ge=MIN_EDIT_COLOR, le=MAX_EDIT_COLOR)
    contrast: float = Field(1.0, ge=MIN_EDIT_COLOR, le=MAX_EDIT_COLOR)
    saturation: float = Field(1.0, ge=MIN_EDIT_COLOR, le=MAX_EDIT_COLOR)
    warmth: float = Field(0.0, ge=-MAX_EDIT_WARMTH, le=MAX_EDIT_WARMTH)
    hue: float = Field(0.0, ge=0.0, lt=360.0)

    @model_validator(mode="after")
    def _check(self) -> "ImageEditSpec":
        self.crop = validated_crop(self.crop)
        self.masks = validated_masks(self.masks)

        return self


class ImageEditStateResponse(BaseModel):
    path: str
    has_backup: bool
    spec: ImageEditSpec | None


class ImageEditResponse(BaseModel):
    path: str
    size: int
    modified_at: str
    width: int | None = None
    height: int | None = None
    has_backup: bool


class ComfyCandidateSidecar(BaseModel):
    source_name: str
    preset: str
    #: ComfyUI's queue id, not the text below.
    prompt_id: str | None = None
    seed: int | None = None
    prompt_text: str | None = None
    #: Written at job time, the one moment both images are already decoded.
    difference_percent: float | None = None
    created_at: str


class ComfyCandidateStateResponse(BaseModel):
    path: str
    candidate_path: str | None = None
    has_candidate: bool = False
    preset: str | None = None
    prompt_id: str | None = None
    seed: int | None = None
    #: Null when neither the record nor a fresh read could produce one.
    difference_percent: float | None = None
    created_at: str | None = None


class ComfyCandidateResponse(BaseModel):
    path: str
    accepted: bool
    size: int
    modified_at: str
    width: int | None = None
    height: int | None = None


class ComfyCandidateBatchRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)


class ComfyCandidateFailure(BaseModel):
    path: str
    detail: str


class ComfyCandidateBatchResponse(BaseModel):
    """Never all-or-nothing: a locked file must not fail the rest of the batch."""

    settled: list[str] = Field(default_factory=list)
    #: No candidate is not an error.
    skipped: list[str] = Field(default_factory=list)
    failed: list[ComfyCandidateFailure] = Field(default_factory=list)


class JobEvent(BaseModel):
    type: Literal["job"] = "job"
    job: JobResponse


class ExternalJobsEvent(BaseModel):
    type: Literal["external_jobs"] = "external_jobs"
    jobs: list[ExternalOstrisJobResponse] = Field(default_factory=list)
    active_count: int = 0
    available: bool = False


class HeartbeatEvent(BaseModel):
    """A real event rather than an SSE comment, so a quiet stream still reaches ``onmessage``."""

    type: Literal["heartbeat"] = "heartbeat"


class FolderEvent(BaseModel):
    """Carries the new fingerprint, not the change; empty when the folder became unreadable."""

    type: Literal["folder"] = "folder"
    path: str
    fingerprint: str = ""


#: Every event is a complete snapshot, never a delta.
class VideoEditEvent(BaseModel):
    """Addressed to the tab that asked, not broadcast."""

    type: Literal["video_edit"] = "video_edit"
    path: str
    #: Position in the rendered output, in seconds.
    seconds: float
    #: ``None`` when the source duration was unknown.
    duration: float | None = None


type ServerEvent = Annotated[
    JobEvent | ExternalJobsEvent | HeartbeatEvent | FolderEvent | VideoEditEvent,
    Field(discriminator="type"),
]

#: Types no route mentions, so generate_types.py merges them in by hand.
EXTRA_WIRE_MODELS = (ServerEvent, JobType, JobStatus)

#: Runtime-checked on the client. Only unvalidated arrivals belong here; event frames are pushed.
GUARDED_WIRE_MODELS = (ServerEvent,)
