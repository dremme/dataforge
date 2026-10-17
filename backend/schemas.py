from itertools import pairwise
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from constants import (
    ADJUST_MAX_HUE,
    AUTO_ADJUST_DEFAULT_AMOUNT,
    DEFAULT_GALLERY_SORT,
    DEFAULT_RESIZE_MEGAPIXELS,
    DEFAULT_RESIZE_MULTIPLE,
    MAX_RESIZE_MEGAPIXELS,
    MAX_RESIZE_MULTIPLE,
    VIDEO_PROJECT_MAX_KEYFRAMES,
    VIDEO_PROJECT_MAX_TRACKS,
    VIDEO_PROJECT_MIN_CLIP_SECONDS,
    VIDEO_PROJECT_TIME_EPSILON,
)

# PEP 695 ``type`` aliases so pydantic emits named schemas, which become TS unions.

#: ``no_caption`` is a job stat key, not one of these.
type CaptionStatus = Literal["none", "empty", "text"]

#: GIF is its own type so it renders as ``<img>``.
type MediaType = Literal["image", "video", "gif", "audio"]

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
#: Whether a sampling pass ran, a switch routed around it, or it is bypassed in the editor.
type ComfyPassStatus = Literal["ran", "switched_off", "bypassed"]
type ComfyMapNodeKind = Literal[
    "pass", "model", "loras", "clip", "vae", "prompt", "input", "output"
]
type ComfyMediaKind = Literal["image", "video", "audio"]

#: Keys of ``TRAINING_TEMPLATES``; ``h3_*`` are video, ``krea2_*`` and ``qwen_image_2*`` image.
type TrainingModel = Literal[
    "krea2_raw", "krea2_turbo", "qwen_image_2", "qwen_image_2_turbo", "h3_fl2va", "h3_ref2va"
]

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
    "check_caption_rules",
    "edit_captions",
    "batch_rename",
    "backup_captions",
    "restore_captions",
    "train_lora",
    "watermark",
    "auto_adjust",
    "resize",
    "comfy_process",
]

type NotificationVariant = Literal["danger", "warning", "success"]

#: ``job`` rows are composed server-side; ``client`` rows are toasts the UI posted back.
type NotificationSource = Literal["job", "client"]

#: The drawer's status filter; ``stopped`` covers both cancelled and interrupted.
type JobHistoryStatus = Literal["active", "completed", "failed", "stopped"]

#: ``prepend`` and ``append`` ignore the search term.
type CaptionReplaceMode = Literal["replace", "prepend", "append"]

#: Named rather than a raw distance so the wire does not depend on hash width.
type DuplicateThreshold = Literal["exact", "near", "loose"]

#: The suffix never crosses the wire; the backend resolves the filename.
type SidecarKind = Literal["issue", "duplicate", "empty_caption"]


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


class FolderReviewCountsResponse(BaseModel):
    """Fetched per folder on demand, so listing a folder never pays for its children's staging."""

    path: str
    issue_count: int
    duplicate_count: int
    candidate_count: int


class SubfolderStatsResponse(BaseModel):
    folder: str
    subfolders: list[SubfolderStats]


class MediaTag(BaseModel):
    label: str
    #: The best detection score across the file's frames, from 0 to 1.
    confidence: float


class GalleryItem(BaseModel):
    name: str
    path: str
    description: str | None
    has_description: bool
    has_caption_file: bool
    issue_fixes: list[str] = Field(default_factory=list)
    rule_findings: list[str] = Field(default_factory=list)
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
    #: Empty for stills, GIFs, non-MP4-family containers, and audio mutagen cannot read.
    duration: float | None = None
    size: int | None = None
    #: Filesystem creation time; unknown when the filesystem does not expose birthtime.
    created_at: str | None = None
    modified_at: str | None = None
    has_backup: bool = False
    #: Strongest first, above the confidence setting. Only favorite folders are tagged.
    tags: list[MediaTag] = Field(default_factory=list)


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


class FolderDeleteResponse(BaseModel):
    path: str
    parent: str
    deletes_to_trash: bool


class FolderFingerprintResponse(BaseModel):
    fingerprint: str


class FolderChangesResponse(BaseModel):
    """``full`` means refetch the whole folder; ``changed`` covers both new and edited items.

    ``stale_subfolders`` names subfolders whose counts changed under a delta, which keeps them.
    """

    full: bool = False
    fingerprint: str
    changed: list[GalleryItem] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)
    stale_subfolders: list[str] = Field(default_factory=list)


class FolderResponse(BaseModel):
    path: str
    home: str
    parent: str | None
    breadcrumbs: list[Breadcrumb]
    subfolders: list[Subfolder]
    items: list[GalleryItem]
    #: The folder's own .sysprompt; a parent's file does not count.
    has_sysprompt: bool = False
    #: A non-empty .sysprompt reaches this folder, its own or a parent's.
    sysprompt_applies: bool = False
    has_caption_backup: bool = False
    #: The folder's own .captionrules; a parent's file does not count.
    has_caption_rules: bool = False
    item_count: int
    subfolder_count: int
    fingerprint: str = ""


class HealthResponse(BaseModel):
    status: str = "ok"


class SystemSpecsResponse(BaseModel):
    cpu_name: str
    cpu_cores: int
    cpu_load_percent: float | None = None
    cpu_temperature_celsius: float | None = None
    memory_total_bytes: int
    memory_used_bytes: int
    gpu_name: str | None = None
    gpu_memory_bytes: int | None = None
    gpu_memory_used_bytes: int | None = None
    gpu_load_percent: float | None = None
    gpu_temperature_celsius: float | None = None
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


type ThemePreference = Literal["system", "light", "dark"]


class JobsDrawerFilters(BaseModel):
    #: Empty means every type.
    job_types: list[JobType] = Field(default_factory=list)
    status: JobHistoryStatus | Literal["all"] = "all"
    folder: Literal["all", "current"] = "all"


# 0 hides the caption and its status pill.
type SmallCardCaptionLines = Literal[0, 1, 2, 4]
type LargeCardCaptionLines = Literal[0, 2, 4, 6]


class GalleryCardSettings(BaseModel):
    small_caption_lines: SmallCardCaptionLines = 2
    large_caption_lines: LargeCardCaptionLines = 4
    #: Shown beside the file name on small and large cards.
    megapixels: bool = True
    #: Large cards only; shown beside the megapixels.
    large_aspect_ratio: bool = True
    #: Large cards only; the strongest tags in one row under the caption.
    large_tags: bool = True
    list_caption_preview: bool = False


# Languages browsers commonly ship spelling dictionaries for.
type SpellcheckLanguage = Literal[
    "en-US",
    "en-GB",
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "pl",
    "sv",
    "da",
    "nb",
    "fi",
    "cs",
    "ru",
    "uk",
    "tr",
]


class EditorSettings(BaseModel):
    line_wrap: bool = True
    line_numbers: bool = True
    #: Caption editor only.
    caption_spellcheck: bool = True
    caption_spellcheck_language: SpellcheckLanguage = "en-US"
    #: Caption editor only; Ctrl+Space still asks for suggestions when off.
    caption_suggestions: bool = True


class UiSettingsResponse(BaseModel):
    sort: GallerySort = DEFAULT_GALLERY_SORT
    show_automation_specs: bool = False
    theme: ThemePreference = "system"
    #: On by default: accepting a ComfyUI candidate would otherwise lose the original's metadata.
    keep_candidate_metadata: bool = True
    jobs_drawer_filters: JobsDrawerFilters = Field(default_factory=JobsDrawerFilters)
    gallery_cards: GalleryCardSettings = Field(default_factory=GalleryCardSettings)
    editor: EditorSettings = Field(default_factory=EditorSettings)


class UiSettingsUpdate(BaseModel):
    # Deliberately not ``GallerySort``: an unknown sort resets to the default instead of failing.
    sort: str | None = None
    show_automation_specs: bool | None = None
    theme: ThemePreference | None = None
    keep_candidate_metadata: bool | None = None
    jobs_drawer_filters: JobsDrawerFilters | None = None
    gallery_cards: GalleryCardSettings | None = None
    editor: EditorSettings | None = None


type AppSettingKey = Literal[
    "vision_base_url",
    "vision_api_key",
    "vision_model",
    "vision_max_tokens",
    "vision_top_k",
    "draft_caption_threshold",
    "thinking_temperature",
    "thinking_top_p",
    "thinking_min_p",
    "thinking_presence_penalty",
    "thinking_repeat_penalty",
    "instruct_temperature",
    "instruct_top_p",
    "instruct_min_p",
    "instruct_presence_penalty",
    "instruct_repeat_penalty",
    "image_max_pixels",
    "video_keyframes_per_second",
    "video_max_keyframes",
    "video_frame_max_pixels",
    "video_frame_min_pixels",
    "comfy_base_url",
    "ai_toolkit_base_url",
    "thumbnail_cache_max_mb",
    "job_history_days",
    "notification_history_days",
    "tag_min_confidence",
]

type SettingSource = Literal["saved", "env", "default"]

type FallbackSource = Literal["env", "default"]


class TextSettingState(BaseModel):
    value: str
    source: SettingSource
    fallback: str
    fallback_source: FallbackSource


class NumberSettingState(BaseModel):
    value: int | float
    source: SettingSource
    fallback: int | float
    fallback_source: FallbackSource
    minimum: int | float
    maximum: int | float | None


class SecretSettingState(BaseModel):
    """Never carries the secret itself, only whether one applies and where it comes from."""

    is_set: bool
    source: SettingSource
    fallback_source: FallbackSource


class AppSettingsResponse(BaseModel):
    """``fallback`` is what a reset would restore: the environment's value, else the built-in default."""

    vision_base_url: TextSettingState
    vision_api_key: SecretSettingState
    vision_model: TextSettingState
    vision_max_tokens: NumberSettingState
    vision_top_k: NumberSettingState
    draft_caption_threshold: NumberSettingState
    thinking_temperature: NumberSettingState
    thinking_top_p: NumberSettingState
    thinking_min_p: NumberSettingState
    thinking_presence_penalty: NumberSettingState
    thinking_repeat_penalty: NumberSettingState
    instruct_temperature: NumberSettingState
    instruct_top_p: NumberSettingState
    instruct_min_p: NumberSettingState
    instruct_presence_penalty: NumberSettingState
    instruct_repeat_penalty: NumberSettingState
    image_max_pixels: NumberSettingState
    video_keyframes_per_second: NumberSettingState
    video_max_keyframes: NumberSettingState
    video_frame_max_pixels: NumberSettingState
    video_frame_min_pixels: NumberSettingState
    comfy_base_url: TextSettingState
    ai_toolkit_base_url: TextSettingState
    thumbnail_cache_max_mb: NumberSettingState
    job_history_days: NumberSettingState
    notification_history_days: NumberSettingState
    tag_min_confidence: NumberSettingState


class AppSettingsOverrides(BaseModel):
    """``None`` means not saved, so the environment or the default applies."""

    vision_base_url: str | None = None
    vision_api_key: str | None = None
    vision_model: str | None = None
    vision_max_tokens: int | None = None
    vision_top_k: int | None = None
    draft_caption_threshold: int | None = None
    thinking_temperature: float | None = None
    thinking_top_p: float | None = None
    thinking_min_p: float | None = None
    thinking_presence_penalty: float | None = None
    thinking_repeat_penalty: float | None = None
    instruct_temperature: float | None = None
    instruct_top_p: float | None = None
    instruct_min_p: float | None = None
    instruct_presence_penalty: float | None = None
    instruct_repeat_penalty: float | None = None
    image_max_pixels: int | None = None
    video_keyframes_per_second: int | None = None
    video_max_keyframes: int | None = None
    video_frame_max_pixels: int | None = None
    video_frame_min_pixels: int | None = None
    comfy_base_url: str | None = None
    ai_toolkit_base_url: str | None = None
    thumbnail_cache_max_mb: int | None = None
    job_history_days: int | None = None
    notification_history_days: int | None = None
    tag_min_confidence: float | None = None


class AppSettingsUpdate(AppSettingsOverrides):
    """A key in both ``reset`` and the values ends up saved with the new value."""

    reset: list[AppSettingKey] = Field(default_factory=list)


type ProbedService = Literal["vision", "comfy", "ai_toolkit"]


class ServiceProbeRequest(BaseModel):
    """``api_key`` is only read for the vision server; omitted, the key in force is used."""

    service: ProbedService
    base_url: str
    api_key: str | None = None


class ServiceProbeResponse(BaseModel):
    reachable: bool
    detail: str | None = None
    models: list[str] = Field(default_factory=list)


class RememberedDataResponse(BaseModel):
    job_option_folders: int
    display_mode_folders: int


#: ``setup`` is the checksum-verified build setup installs into the clone.
type FfmpegSource = Literal["setup", "path", "bundled"]


class AboutResponse(BaseModel):
    version: str
    python_version: str
    platform: str
    ffmpeg_path: str | None = None
    ffmpeg_source: FfmpegSource | None = None
    env_file: str | None = None
    database_path: str
    thumbnail_cache_dir: str
    workflows_dir: str


type TaggingState = Literal["unavailable", "idle", "loading", "tagging", "failed"]


class TaggingStatusResponse(BaseModel):
    state: TaggingState
    #: Why tagging is unavailable or failed; empty otherwise.
    detail: str = ""
    model: str
    vocabulary_size: int
    #: Files in favorite folders still waiting for tags, as of the last pass.
    pending: int = 0
    #: The favorite being worked on; set only while loading or tagging.
    folder: str | None = None


class ThumbnailCacheStats(BaseModel):
    directory: str
    file_count: int
    size_bytes: int


class ThumbnailCacheCleared(BaseModel):
    removed_files: int
    freed_bytes: int


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
    rule_findings: list[str] = Field(default_factory=list)
    has_issue_file: bool = False


class CaptionBackupResponse(BaseModel):
    exists: bool
    description: str | None = None


class InstructionFileResponse(BaseModel):
    """A .sysprompt or .captionrules as one folder sees it."""

    #: The folder's own file; empty when it has none.
    text: str
    has_file: bool
    #: The nearest parent holding the file; it applies wherever the folder has none of its own.
    parent_folder: str | None
    #: The parent's file as seen from the folder, e.g. ``../.captionrules``.
    parent_relative_path: str | None
    parent_text: str
    #: A queued or running job that reads this file; saves are refused until it finishes.
    locked_by_job_id: str | None


class FolderInstructionsResponse(BaseModel):
    sysprompt: InstructionFileResponse
    caption_rules: InstructionFileResponse
    #: A starting point for a folder without caption rules.
    caption_rules_template: str


class InstructionFileUpdate(BaseModel):
    text: str


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


class AutoAdjustStartRequest(JobSelectionRequest):
    # Never remembered: discarding earlier adjustments must be re-chosen every run.
    replace_adjustments: bool = Field(
        default=False,
        description="Reset every Adjust tool first, so a file keeps only the wand's suggestion.",
    )
    reset_adjustments: bool = Field(
        default=False,
        description="Reset only color adjustments to zero without applying the wand; overrides replace.",
    )


class CheckCaptionRulesStartRequest(JobSelectionRequest):
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


class ResizeJobSettings(BaseModel):
    megapixels: float = Field(DEFAULT_RESIZE_MEGAPIXELS, gt=0, le=MAX_RESIZE_MEGAPIXELS)
    multiple: int = Field(DEFAULT_RESIZE_MULTIPLE, ge=1, le=MAX_RESIZE_MULTIPLE)


class ResizeStartRequest(JobSelectionRequest, ResizeJobSettings):
    # Never remembered: discarding earlier sizing must be re-chosen every run.
    reset_size: bool = Field(
        default=False,
        description="Clear the size fit and scale instead of applying the budget.",
    )


class ComfyPresetSettings(BaseModel):
    """What the dialog remembers for one workflow preset."""

    #: Empty runs the preset's own seeds.
    seed: int | None = None
    #: Named ``prompt_text`` because ``prompt`` is the whole graph elsewhere.
    prompt_text: str = ""


class ComfyProcessJobSettings(ComfyPresetSettings):
    #: A stem, not a Literal: unknown names are the job's own 400.
    preset: str = ""
    #: Off by default so a re-run picks up where the last stopped.
    overwrite_candidates: bool = False


class ComfyProcessStartRequest(JobSelectionRequest, ComfyProcessJobSettings):
    pass


class ComfyProcessSettingsResponse(BaseModel):
    """Prompt and seed are remembered per preset, so switching workflows keeps each one's even
    when the other preset has no node for them. The checkbox stays per folder."""

    #: The preset of the most recent run, in any folder.
    preset: str = ""
    overwrite_candidates: bool = False
    by_preset: dict[str, ComfyPresetSettings] = Field(default_factory=dict)


class ComfyPresetSummary(BaseModel):
    name: str
    modified_at: str | None = None
    #: Null when the preset could not be parsed, so the dialog leaves both fields enabled.
    accepts_prompt: bool | None = None
    accepts_seed: bool | None = None


class ComfyLogsResponse(BaseModel):
    """ComfyUI's recent console output. A stopped ComfyUI and one too old to expose its log are
    the same answer here, because neither is an error the panel should shout about."""

    lines: list[str] = Field(default_factory=list)
    available: bool = False


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
    mode: AutomationMode = "thinking"
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


class EditCaptionsPreviewRequest(JobSelectionRequest, EditCaptionsJobSettings):
    pass


class CaptionEditPreviewSample(BaseModel):
    name: str
    before: str
    after: str | None = None
    error: str | None = None


class EditCaptionsPreviewResponse(BaseModel):
    samples: list[CaptionEditPreviewSample] = Field(default_factory=list)


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
    resize: ResizeJobSettings = Field(default_factory=ResizeJobSettings)
    comfy_process: ComfyProcessSettingsResponse = Field(
        default_factory=ComfyProcessSettingsResponse
    )


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
    job_type: JobType
    status: JobStatus
    total: int
    processed: int
    current_file: str | None = None
    current_name: str | None = None
    stats: dict[str, int] = Field(default_factory=dict)
    error: str | None = None
    #: ``status`` once stats are weighed: a completed job holding API errors reads as failed.
    effective_status: JobStatus = "queued"
    #: Set when the job finished cleanly but skipped work the user should know about.
    warning: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    auto_caption_mode: str | None = None
    external_ref: str | None = Field(
        default=None,
        description="The external job this one co-tracks (the AI-Toolkit training name).",
    )
    #: The ComfyUI preset name or the training model key the run used.
    workflow: str | None = None
    #: The training template was edited for this run instead of the shipped one.
    workflow_edited: bool = False
    #: Of two copies of this job, the one with the higher revision is newer.
    revision: int = 0


class JobResultsResponse(BaseModel):
    """Served separately because a finished run over a large folder is megabytes."""

    job_id: str
    results: list[JobFileResult] = Field(default_factory=list)


class JobsResponse(BaseModel):
    jobs: list[JobResponse] = Field(default_factory=list)
    #: Every queued or running job, whatever the filter.
    active_count: int = 0
    #: Jobs matching the filter, across all pages.
    total: int = 0
    #: Every change stamped below this is reflected in ``jobs``; a job missing from the list
    #: with a lower revision was deleted, one with a higher revision is newer than the list.
    revision: int = 0


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
    #: Shared with ``ExternalJobsEvent``: the snapshot with the higher revision is newer.
    revision: int = 0


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


class FolderFavoritesOrderRequest(BaseModel):
    paths: list[str]


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


class ComfySamplingStage(BaseModel):
    """One sampling pass on the way to an output, with the settings only it reads."""

    node_id: str
    label: str
    #: The innermost subgraph the pass sits in.
    group: str | None = None
    status: ComfyPassStatus = "ran"
    parameters: list[ComfyParameter] = Field(default_factory=list)
    loras: list[str] = Field(default_factory=list)


class ComfyMapNode(BaseModel):
    """One box of an output's map: a pass, or a model, LoRAs, VAE, input or prompt feeding one."""

    id: str
    kind: ComfyMapNodeKind
    label: str
    #: The full text behind a short label: a prompt, a model, CLIP or VAE file or LoRA names.
    detail: list[str] = Field(default_factory=list)
    status: ComfyPassStatus = "ran"
    #: Map nodes this one hands its result to directly.
    feeds: list[str] = Field(default_factory=list)
    #: Set on a prompt box only.
    role: ComfyPromptRole | None = None
    #: Set on an input or output box: what kind of media it is.
    media: ComfyMediaKind | None = None
    #: Set on an input an earlier stage generated: that stage's name.
    source: str | None = None


class ComfyOutputBranch(BaseModel):
    """One possible workflow output, named by the subgraph that fed it."""

    node_id: str
    class_type: str
    label: str
    filename_prefix: str | None = None
    filename: str | None = None
    is_preview: bool = False
    matches_filename: bool = False
    prompts: list[ComfyPromptText] = Field(default_factory=list)
    #: With ``stages``, only the settings no single pass owns; otherwise every setting.
    parameters: list[ComfyParameter] = Field(default_factory=list)
    loras: list[str] = Field(default_factory=list)
    #: Sampling passes, earliest first; empty when the output has one pass and it ran.
    stages: list[ComfySamplingStage] = Field(default_factory=list)
    #: The passes and what feeds them, earliest first; empty when nothing samples.
    map: list[ComfyMapNode] = Field(default_factory=list)


class ComfyWorkflowPromptsResponse(BaseModel):
    """``matched_node_id`` identifies a unique filename match, not confirmed provenance."""

    has_workflow: bool
    branches: list[ComfyOutputBranch] = Field(default_factory=list)
    matched_node_id: str | None = None
    orphan_prompts: list[ComfyPromptText] = Field(default_factory=list)
    #: Whether ``/comfy-workflow/editor`` has a workflow ComfyUI would load from a paste.
    has_editor_workflow: bool = False
    #: Several outputs match the filename; ``matched_node_id`` is the one set to the file's size.
    matched_by_size: bool = False


class ComfyEditorWorkflowResponse(BaseModel):
    """The editor-format workflow trimmed to one output, JSON text ready for the clipboard."""

    workflow: str


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
MIN_TRIM_SECONDS = 0.1

#: Float noise from a normalized drag can push a full-width rect past 1.0.
CROP_BOUNDS_EPSILON = 1e-6

MAX_MASK_REGIONS = 24
MIN_MASK_STRENGTH = 0.02
MAX_MASK_STRENGTH = 0.5


class SizeFit(BaseModel):
    """A pixel budget at the frame's own aspect, both sides snapped to ``multiple``.

    Applied at the scale step, in place of ``scale``; it never upscales."""

    megapixels: float = Field(gt=0, le=MAX_RESIZE_MEGAPIXELS)
    multiple: int = Field(ge=1, le=MAX_RESIZE_MULTIPLE)


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


type AdjustTone = Annotated[float, Field(ge=-1.0, le=1.0)]
type AdjustDetail = Annotated[float, Field(ge=0.0, le=1.0)]


class ColorAdjust(BaseModel):
    """Adjust tool positions, each 0 at rest. Detail runs first, then everything else as one LUT."""

    exposure: AdjustTone = 0.0
    brilliance: AdjustTone = 0.0
    highlights: AdjustTone = 0.0
    shadows: AdjustTone = 0.0
    contrast: AdjustTone = 0.0
    brightness: AdjustTone = 0.0
    black_point: AdjustTone = 0.0
    white_point: AdjustTone = 0.0
    saturation: AdjustTone = 0.0
    vibrance: AdjustTone = 0.0
    warmth: AdjustTone = 0.0
    tint: AdjustTone = 0.0
    hue: float = Field(0.0, ge=-ADJUST_MAX_HUE, le=ADJUST_MAX_HUE)
    definition: AdjustDetail = 0.0
    noise_reduction: AdjustDetail = 0.0


class AutoAdjust(BaseModel):
    """What the wand last read, kept so its dial can rescale it after a reopen. Never rendered."""

    amount: float = Field(AUTO_ADJUST_DEFAULT_AMOUNT, ge=0.0, le=1.0)
    suggestion: ColorAdjust
    base: ColorAdjust | None = None


class AutoAdjustResponse(BaseModel):
    suggestion: ColorAdjust


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
    fit: SizeFit | None = None
    #: Audio gain: 1 unchanged, 0 mutes (the track is dropped), up to 2 for a boost.
    volume: float = Field(1.0, ge=MIN_EDIT_VOLUME, le=MAX_EDIT_VOLUME)
    adjust: ColorAdjust = Field(default_factory=ColorAdjust)
    auto_adjust: AutoAdjust | None = None

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
    #: None when no rate could be read; the editor then falls back to an assumed frame grid.
    frame_rate: float | None = None
    spec: VideoEditSpec | None


class VideoEditResponse(BaseModel):
    path: str
    size: int
    modified_at: str
    width: int | None = None
    height: int | None = None
    has_backup: bool


class ImageEditSpec(BaseModel):
    """Order is mask, crop, mirror, rotate, scale, adjust — shared with the frontend overlay."""

    masks: list[MaskRegion] = Field(default_factory=list, max_length=MAX_MASK_REGIONS)
    crop: EditCropRect | None = None
    mirror_h: bool = False
    mirror_v: bool = False
    #: Clockwise degrees, applied after the mirrors.
    rotate: Literal[0, 90, 180, 270] = 0
    #: Capped at 1: upscaling invents detail a caption would then describe.
    scale: float = Field(1.0, ge=MIN_EDIT_SCALE, le=1.0)
    fit: SizeFit | None = None
    adjust: ColorAdjust = Field(default_factory=ColorAdjust)
    auto_adjust: AutoAdjust | None = None

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
    #: Both sides, so review can show 24 -> 48 rather than a bare number.
    frame_rate: float | None = None
    source_frame_rate: float | None = None
    frame_count: int | None = None
    source_frame_count: int | None = None
    duration_seconds: float | None = None
    source_duration_seconds: float | None = None
    #: True only when both lengths are known and disagree; an unmeasured clip never flags.
    length_mismatch: bool = False
    #: True only when the source carried an audio track and the candidate does not.
    dropped_audio: bool = False
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
    #: Both sides, so review can show 24 -> 48 rather than a bare number.
    frame_rate: float | None = None
    source_frame_rate: float | None = None
    frame_count: int | None = None
    source_frame_count: int | None = None
    duration_seconds: float | None = None
    source_duration_seconds: float | None = None
    #: True only when both lengths are known and disagree; an unmeasured clip never flags.
    length_mismatch: bool = False
    #: True only when the source carried an audio track and the candidate does not.
    dropped_audio: bool = False
    created_at: str | None = None


class ComfyCandidateResponse(BaseModel):
    path: str
    accepted: bool
    size: int
    modified_at: str
    width: int | None = None
    height: int | None = None
    duration: float | None = None


class ComfyCandidateBatchRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)
    keep_metadata: bool = Field(
        default=False,
        description="Accept only: give each file its original's metadata instead of ComfyUI's.",
    )


class ComfyCandidateFailure(BaseModel):
    path: str
    detail: str


class ComfyCandidateBatchResponse(BaseModel):
    """Never all-or-nothing: a locked file must not fail the rest of the batch."""

    settled: list[str] = Field(default_factory=list)
    #: No candidate is not an error.
    skipped: list[str] = Field(default_factory=list)
    failed: list[ComfyCandidateFailure] = Field(default_factory=list)


type VideoProjectSourceKind = Literal["video", "image", "audio"]
type VideoProjectTrackKind = Literal["video", "audio"]
type VideoProjectClipKind = Literal["video", "image", "audio", "title"]
#: ``fit`` letterboxes inside the canvas, ``fill`` covers it and crops the overflow.
type VideoProjectFitMode = Literal["fit", "fill"]
type VideoProjectTitleAlign = Literal["left", "center", "right"]
type VideoProjectSizePreset = Literal["source", "720p", "1080p"]
type VideoProjectOrientation = Literal["landscape", "portrait", "square"]
type VideoProjectQuality = Literal["standard", "high", "small"]
#: ``limit`` holds true peaks under the ceiling; ``normalize`` also brings the mix to the
#: loudness target first. ``unchanged`` sums the clips as they are and can clip.
type VideoProjectAudioLevel = Literal["unchanged", "limit", "normalize"]
#: ``changed`` means the file's size or modification time no longer matches the recorded one.
type VideoProjectSourceState = Literal["ok", "missing", "changed"]
type VideoProjectExportStatus = Literal["running", "completed", "failed", "cancelled"]
#: How a keyframe travels to the next one; ``hold`` keeps its value until the next one starts.
type VideoProjectEasing = Literal["linear", "ease_in", "ease_out", "ease_in_out", "hold"]
#: ``equal_power`` keeps the sum of a crossfade's two sides at a steady loudness.
type VideoProjectFadeCurve = Literal["linear", "equal_power"]

MAX_PROJECT_CLIPS = 1000
MAX_PROJECT_DIMENSION = 7680
MIN_PROJECT_DIMENSION = 16
MAX_PROJECT_FRAME_RATE = 120.0
MAX_TITLE_LENGTH = 500
MAX_PROJECT_MARKERS = 500

type HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
type ProjectId = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class VideoProjectSource(BaseModel):
    """A file in the project's own folder, named rather than pathed so the folder can move."""

    id: ProjectId
    name: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    kind: VideoProjectSourceKind
    #: Size and mtime as recorded when the source was added or last accepted. Microseconds, not
    #: nanoseconds: a browser holds integers exactly only up to 2**53.
    size: int = Field(ge=0)
    modified_us: int = Field(ge=0)
    duration: float | None = Field(None, gt=0)
    width: int | None = Field(None, gt=0)
    height: int | None = Field(None, gt=0)
    frame_rate: float | None = Field(None, gt=0)
    has_audio: bool = False


class VideoProjectTrack(BaseModel):
    id: ProjectId
    kind: VideoProjectTrackKind
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    locked: bool = False
    #: Video tracks only: a hidden track is left out of the preview and the export.
    hidden: bool = False
    #: Audio tracks only.
    muted: bool = False
    solo: bool = False
    #: Audio tracks only: multiplies every clip on the track.
    gain: float = Field(1.0, ge=MIN_EDIT_VOLUME, le=MAX_EDIT_VOLUME)
    #: Audio tracks only: while one of its clips sounds, the other tracks are ducked.
    speech: bool = False
    #: Ripple edits on other tracks (ripple delete, insert, ripple trim) move this one too.
    #: Off, they leave it alone unless one of its clips is linked to a clip they move.
    sync_lock: bool = True


class VideoProjectTransform(BaseModel):
    """Offsets are fractions of the canvas, measured from its center to the clip's center."""

    x: float = Field(0.0, ge=-2.0, le=2.0)
    y: float = Field(0.0, ge=-2.0, le=2.0)
    #: Multiplies the fit or fill size.
    scale: float = Field(1.0, ge=0.05, le=8.0)
    #: Clockwise degrees.
    rotation: float = Field(0.0, ge=-360.0, le=360.0)
    opacity: float = Field(1.0, ge=0.0, le=1.0)


class VideoProjectKeyframe(BaseModel):
    """A value at a time in timeline seconds from the clip's start. The time may lie outside the
    clip, as after a split or a trim, so the part still shown keeps its motion."""

    time: float = Field(ge=-86400.0, le=86400.0)
    value: float
    #: Shapes the way from this keyframe to the next one.
    easing: VideoProjectEasing = "linear"


type KeyframeList = Annotated[
    list[VideoProjectKeyframe], Field(max_length=VIDEO_PROJECT_MAX_KEYFRAMES)
]

#: The range each animated property accepts, as its static value does.
KEYFRAME_RANGES: dict[str, tuple[float, float]] = {
    "x": (-2.0, 2.0),
    "y": (-2.0, 2.0),
    "scale": (0.05, 8.0),
    "rotation": (-360.0, 360.0),
    "opacity": (0.0, 1.0),
    "gain": (MIN_EDIT_VOLUME, MAX_EDIT_VOLUME),
}


class VideoProjectKeyframes(BaseModel):
    """A clip's animation, in time order per property. A property with keyframes follows them
    and ignores its static value: before the first it holds the first value, after the last the
    last one."""

    x: KeyframeList = Field(default_factory=list)
    y: KeyframeList = Field(default_factory=list)
    scale: KeyframeList = Field(default_factory=list)
    rotation: KeyframeList = Field(default_factory=list)
    opacity: KeyframeList = Field(default_factory=list)
    #: Audio clips only: the gain envelope.
    gain: KeyframeList = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "VideoProjectKeyframes":
        for name, (low, high) in KEYFRAME_RANGES.items():
            keys: list[VideoProjectKeyframe] = getattr(self, name)
            for before, after in pairwise(keys):
                if after.time <= before.time + VIDEO_PROJECT_TIME_EPSILON:
                    raise ValueError(f"{name} keyframes must be apart and in time order")
            if any(not low <= key.value <= high for key in keys):
                raise ValueError(f"{name} keyframes must lie between {low} and {high}")
        return self


class VideoProjectFont(BaseModel):
    """An installed family and one of its styles, as Pillow names them; see ``system_fonts``."""

    family: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    style: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] = (
        "Regular"
    )


class VideoProjectTitle(BaseModel):
    """A static text layer drawn over the full canvas."""

    text: Annotated[str, StringConstraints(max_length=MAX_TITLE_LENGTH)] = "Title"
    #: Line height as a fraction of the canvas height.
    size: float = Field(0.08, ge=0.01, le=0.5)
    color: HexColor = "#ffffff"
    align: VideoProjectTitleAlign = "center"
    #: Anchor point as fractions of the canvas; ``align`` decides which edge sits on it.
    x: float = Field(0.5, ge=0.0, le=1.0)
    y: float = Field(0.5, ge=0.0, le=1.0)
    #: Fraction of the text size; 0 draws no outline.
    outline: float = Field(0.0, ge=0.0, le=0.25)
    outline_color: HexColor = "#000000"
    #: None draws the default font, as does a family this machine does not have.
    font: VideoProjectFont | None = None


class VideoProjectClip(BaseModel):
    """One placement on a track. ``start`` and ``duration`` are timeline seconds; ``source_in``
    is where the take begins in the source, so it spans ``duration * speed`` source seconds."""

    id: ProjectId
    track_id: ProjectId
    kind: VideoProjectClipKind
    #: None for titles only.
    source_id: ProjectId | None = None
    start: float = Field(ge=0.0)
    duration: float = Field(ge=VIDEO_PROJECT_MIN_CLIP_SECONDS)
    source_in: float = Field(0.0, ge=0.0)
    speed: float = Field(1.0, ge=MIN_EDIT_SPEED, le=MAX_EDIT_SPEED)
    #: Clips sharing a link id move, trim, split and retime together.
    link_id: ProjectId | None = None
    transform: VideoProjectTransform = Field(default_factory=VideoProjectTransform)
    crop: EditCropRect | None = None
    fit: VideoProjectFitMode = "fit"
    adjust: ColorAdjust = Field(default_factory=ColorAdjust)
    #: What the wand last read, so its dial can rescale it; ``adjust`` already includes it.
    auto_adjust: AutoAdjust | None = None
    #: Audio clips only.
    gain: float = Field(1.0, ge=MIN_EDIT_VOLUME, le=MAX_EDIT_VOLUME)
    fade_in: float = Field(0.0, ge=0.0)
    fade_out: float = Field(0.0, ge=0.0)
    #: Audio clips only: the shape of its fades and of the crossfades it takes part in.
    fade_curve: VideoProjectFadeCurve = "equal_power"
    title: VideoProjectTitle | None = None
    keyframes: VideoProjectKeyframes = Field(default_factory=VideoProjectKeyframes)

    @property
    def end(self) -> float:
        return self.start + self.duration

    @model_validator(mode="after")
    def _check(self) -> "VideoProjectClip":
        self.crop = validated_crop(self.crop)
        if self.kind == "title":
            if self.source_id is not None or self.title is None:
                raise ValueError("A title clip carries its text and no source")
        elif self.source_id is None:
            raise ValueError(f"A {self.kind} clip needs a source")
        if self.fade_in + self.fade_out > self.duration + VIDEO_PROJECT_TIME_EPSILON:
            raise ValueError("A clip's fades cannot be longer than the clip")
        keys = self.keyframes
        if self.kind == "audio":
            if keys.x or keys.y or keys.scale or keys.rotation or keys.opacity:
                raise ValueError("Only pictures and titles animate a transform")
        elif keys.gain:
            raise ValueError("Only sound clips carry a gain envelope")
        return self


class VideoProjectTransition(BaseModel):
    """A cross-dissolve. Its length is the overlap of the two clips, never stored on its own."""

    id: ProjectId
    from_clip_id: ProjectId
    to_clip_id: ProjectId


class VideoProjectMarker(BaseModel):
    """A named point on the timeline, such as a beat or a shot note. Edits never move it."""

    id: ProjectId
    time: float = Field(ge=0.0)
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""
    note: Annotated[str, StringConstraints(max_length=500)] = ""


class VideoProjectExportSettings(BaseModel):
    #: Empty asks for the default, ``<initial source stem>-edited.mp4``.
    filename: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    size: VideoProjectSizePreset = "source"
    #: None follows the project's own shape.
    orientation: VideoProjectOrientation | None = None
    quality: VideoProjectQuality = "standard"
    copy_caption: bool = False
    audio_level: VideoProjectAudioLevel = "limit"


class VideoProjectMix(BaseModel):
    #: Multiplies the whole mix before the export's level stage.
    master_gain: float = Field(1.0, ge=MIN_EDIT_VOLUME, le=MAX_EDIT_VOLUME)
    #: What tracks other than speech are multiplied by while speech sounds; 1 turns it off.
    duck_gain: float = Field(0.25, ge=0.0, le=1.0)


class VideoProject(BaseModel):
    """Everything needed to rebuild an edit. Tracks are listed top to bottom as displayed: a
    video track composites above every video track listed after it."""

    format_version: Literal[1] = 1
    id: ProjectId
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    #: Bumped by every save; a save naming an older revision is refused.
    revision: int = Field(0, ge=0)
    created_at: str
    updated_at: str
    width: int = Field(ge=MIN_PROJECT_DIMENSION, le=MAX_PROJECT_DIMENSION)
    height: int = Field(ge=MIN_PROJECT_DIMENSION, le=MAX_PROJECT_DIMENSION)
    frame_rate: float = Field(gt=0.0, le=MAX_PROJECT_FRAME_RATE)
    #: The video the project was started from; its caption is the one an export may copy.
    initial_source_id: ProjectId | None = None
    sources: list[VideoProjectSource] = Field(default_factory=list)
    tracks: list[VideoProjectTrack] = Field(min_length=1, max_length=VIDEO_PROJECT_MAX_TRACKS)
    clips: list[VideoProjectClip] = Field(default_factory=list, max_length=MAX_PROJECT_CLIPS)
    transitions: list[VideoProjectTransition] = Field(default_factory=list)
    mix: VideoProjectMix = Field(default_factory=VideoProjectMix)
    #: In time order.
    markers: list[VideoProjectMarker] = Field(default_factory=list, max_length=MAX_PROJECT_MARKERS)
    export: VideoProjectExportSettings = Field(default_factory=VideoProjectExportSettings)

    @model_validator(mode="after")
    def _check(self) -> "VideoProject":
        validate_project_structure(self)
        return self


_CLIP_KINDS_BY_TRACK: dict[str, frozenset[str]] = {
    "video": frozenset({"video", "image", "title"}),
    "audio": frozenset({"audio"}),
}
_SOURCE_KINDS_BY_CLIP: dict[str, frozenset[str]] = {
    "video": frozenset({"video"}),
    "image": frozenset({"image"}),
    "audio": frozenset({"audio", "video"}),
}


def _unique(ids: list[str], what: str) -> None:
    if len(set(ids)) != len(ids):
        raise ValueError(f"Two {what} share an id")


def validate_project_structure(project: VideoProject) -> None:
    """References resolve, clips sit on tracks of their kind, and nothing on a video track
    overlaps except the two clips of a dissolve. Sound may overlap as a crossfade; see
    ``check_crossfades``."""
    _unique([source.id for source in project.sources], "sources")
    _unique([track.id for track in project.tracks], "tracks")
    _unique([clip.id for clip in project.clips], "clips")
    _unique([transition.id for transition in project.transitions], "transitions")
    _unique([marker.id for marker in project.markers], "markers")
    if any(b.time < a.time for a, b in pairwise(project.markers)):
        raise ValueError("Markers must be in time order")

    sources = {source.id: source for source in project.sources}
    tracks = {track.id: track for track in project.tracks}
    clips = {clip.id: clip for clip in project.clips}

    if project.initial_source_id is not None and project.initial_source_id not in sources:
        raise ValueError("The initial source is not one of the project's sources")

    for clip in project.clips:
        track = tracks.get(clip.track_id)
        if track is None:
            raise ValueError(f"Clip {clip.id} is on a track the project does not have")
        if clip.kind not in _CLIP_KINDS_BY_TRACK[track.kind]:
            raise ValueError(f"A {clip.kind} clip cannot sit on a {track.kind} track")
        if clip.source_id is not None:
            source = sources.get(clip.source_id)
            if source is None:
                raise ValueError(f"Clip {clip.id} names a source the project does not have")
            if source.kind not in _SOURCE_KINDS_BY_CLIP[clip.kind]:
                raise ValueError(f"A {clip.kind} clip cannot play a {source.kind} file")

    paired: set[frozenset[str]] = set()
    for transition in project.transitions:
        first = clips.get(transition.from_clip_id)
        second = clips.get(transition.to_clip_id)
        if first is None or second is None:
            raise ValueError("A dissolve names a clip the project does not have")
        if first.track_id != second.track_id or tracks[first.track_id].kind != "video":
            raise ValueError("A dissolve joins two clips on the same video track")
        if not (first.start < second.start < first.end - VIDEO_PROJECT_TIME_EPSILON):
            raise ValueError("A dissolve needs its second clip to overlap the end of the first")
        if second.end <= first.end:
            raise ValueError("A dissolve's second clip must run past the first")
        paired.add(frozenset({first.id, second.id}))

    by_track: dict[str, list[VideoProjectClip]] = {}
    for clip in project.clips:
        by_track.setdefault(clip.track_id, []).append(clip)
    for track_id, track_clips in by_track.items():
        ordered = sorted(track_clips, key=lambda clip: clip.start)
        if tracks[track_id].kind == "audio":
            check_crossfades(ordered, tracks[track_id].name)
            continue
        for index, clip in enumerate(ordered):
            for later in ordered[index + 1 :]:
                if later.start >= clip.end - VIDEO_PROJECT_TIME_EPSILON:
                    break
                if frozenset({clip.id, later.id}) not in paired:
                    track = tracks[clip.track_id]
                    raise ValueError(f"Two clips overlap on {track.name}")


def check_crossfades(ordered: list[VideoProjectClip], track_name: str) -> None:
    """Sound clips on one track, in start order, may overlap the next one and cross-fade over the
    overlap, but never cover a clip whole or sound three at once."""
    for index, clip in enumerate(ordered):
        for later in ordered[index + 1 :]:
            if later.start >= clip.end - VIDEO_PROJECT_TIME_EPSILON:
                break
            if later is not ordered[index + 1]:
                raise ValueError(f"Three clips overlap on {track_name}")
            if later.start <= clip.start + VIDEO_PROJECT_TIME_EPSILON or later.end <= clip.end:
                raise ValueError(f"A clip on {track_name} covers another one whole")


class VideoProjectSourceStatus(BaseModel):
    source_id: str
    state: VideoProjectSourceState
    #: Where the source is looked for: the project folder joined with its name.
    path: str


class VideoProjectDocument(BaseModel):
    """A project as the editor opens it, with each source checked against the folder."""

    #: None for a project not saved yet; the first save allocates a draft name.
    path: str | None = None
    folder: str
    project: VideoProject
    sources: list[VideoProjectSourceStatus] = Field(default_factory=list)
    #: The exported video this project is the snapshot of, when opened from one.
    opened_from_export: str | None = None


class VideoProjectSummary(BaseModel):
    path: str
    name: str
    updated_at: str
    duration: float
    clip_count: int
    initial_source_name: str | None = None
    #: The picture that stands for the project: its first video while that file is here,
    #: otherwise the earliest video or still on the timeline that is. None when none is.
    thumbnail_path: str | None = None


class VideoProjectListResponse(BaseModel):
    projects: list[VideoProjectSummary] = Field(default_factory=list)


class VideoProjectSaveRequest(BaseModel):
    folder: str
    #: None saves a new draft under an allocated name.
    path: str | None = None
    #: The revision the client last read or saved; a newer one on disk refuses the save.
    base_revision: int | None = None
    project: VideoProject


class VideoProjectSaveResponse(BaseModel):
    path: str
    revision: int
    updated_at: str


class VideoProjectFontFamily(BaseModel):
    family: str
    styles: list[str]


class VideoProjectFontsResponse(BaseModel):
    families: list[VideoProjectFontFamily] = Field(default_factory=list)


class VideoProjectAutoAdjustRequest(BaseModel):
    """The part of a source one clip shows: its take, and its crop."""

    path: str
    start: float = Field(0.0, ge=0.0)
    #: None reads to the end of the source; a still has no time and ignores both.
    end: float | None = Field(None, ge=0.0)
    crop: EditCropRect | None = None

    @model_validator(mode="after")
    def _check(self) -> "VideoProjectAutoAdjustRequest":
        self.crop = validated_crop(self.crop)
        return self


class VideoProjectSourceInfo(BaseModel):
    """What adding or relinking a file records about it."""

    path: str
    name: str
    kind: VideoProjectSourceKind
    size: int
    modified_us: int
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    frame_rate: float | None = None
    has_audio: bool = False


class VideoProjectExportSpan(BaseModel):
    """Timeline seconds; an export of a span renders only that part of the edit."""

    start: float = Field(ge=0.0)
    end: float = Field(gt=0.0)

    @model_validator(mode="after")
    def _check(self) -> "VideoProjectExportSpan":
        if self.end - self.start < VIDEO_PROJECT_MIN_CLIP_SECONDS:
            raise ValueError("The range to export is too short")
        return self


class VideoProjectExportRequest(BaseModel):
    folder: str
    #: The draft the export was started from, recorded for the outcome message only.
    project_path: str | None = None
    #: Frozen when the export starts: later draft edits never reach this render.
    project: VideoProject
    #: None exports the whole timeline.
    span: VideoProjectExportSpan | None = None


class VideoProjectExportState(BaseModel):
    id: str
    folder: str
    status: VideoProjectExportStatus
    #: 0..1 of the rendered duration.
    progress: float = 0.0
    output_path: str
    output_name: str
    project_name: str
    project_path: str | None = None
    error: str | None = None
    started_at: str
    finished_at: str | None = None
    #: Measured on the finished file; None while running or when it could not be measured.
    loudness_lufs: float | None = None
    true_peak_db: float | None = None


class VideoProjectExportsResponse(BaseModel):
    exports: list[VideoProjectExportState] = Field(default_factory=list)


class VideoProjectFrameRequest(BaseModel):
    """One frame of the project as the export draws it, at the project's own size."""

    folder: str
    project: VideoProject
    #: Timeline seconds; the frame showing at that time is drawn.
    time: float = Field(ge=0.0)


class VideoProjectCompatibleCopyRequest(BaseModel):
    """A source video the browser cannot play, to be copied as H.264 beside it."""

    path: str


class VideoProjectGradeRequest(BaseModel):
    """A grade kept under a name; saving one under a taken name replaces it."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    adjust: ColorAdjust


class VideoProjectGrade(BaseModel):
    id: str
    name: str
    adjust: ColorAdjust
    created_at: str


class VideoProjectGradesResponse(BaseModel):
    grades: list[VideoProjectGrade] = Field(default_factory=list)


class VideoProjectVersionRequest(BaseModel):
    project: VideoProject
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class VideoProjectVersionSummary(BaseModel):
    id: str
    created_at: str
    #: None for an automatic checkpoint; a named version carries the name it was saved under.
    label: str | None = None
    revision: int
    name: str
    duration: float
    clip_count: int


class VideoProjectVersionsResponse(BaseModel):
    versions: list[VideoProjectVersionSummary] = Field(default_factory=list)


class VideoProjectVersionDocument(BaseModel):
    """A stored version, with its sources checked against the folder it is restored into."""

    project: VideoProject
    sources: list[VideoProjectSourceStatus] = Field(default_factory=list)


class JobEvent(BaseModel):
    type: Literal["job"] = "job"
    job: JobResponse


class JobsRemovedEvent(BaseModel):
    """Deleted or pruned jobs; a listing older than ``revision`` that still holds them is stale."""

    type: Literal["jobs_removed"] = "jobs_removed"
    ids: list[str] = Field(default_factory=list)
    revision: int = 0


class ExternalJobsEvent(BaseModel):
    type: Literal["external_jobs"] = "external_jobs"
    jobs: list[ExternalOstrisJobResponse] = Field(default_factory=list)
    active_count: int = 0
    available: bool = False
    revision: int = 0


class HeartbeatEvent(BaseModel):
    """A real event rather than an SSE comment, so a quiet stream still reaches ``onmessage``."""

    type: Literal["heartbeat"] = "heartbeat"


class ResyncEvent(BaseModel):
    """Frames were dropped for this stream; anything kept current by pushes must be re-read."""

    type: Literal["resync"] = "resync"


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


class VideoProjectExportEvent(BaseModel):
    """Broadcast to every tab, so an export left running in the background stays visible."""

    type: Literal["video_project_export"] = "video_project_export"
    export: VideoProjectExportState


class NotificationRecord(BaseModel):
    id: str
    message: str
    variant: NotificationVariant
    source: NotificationSource = "client"
    #: The job whose outcome this reports; null for toasts the UI raised.
    job_id: str | None = None
    #: Repeats of the newest identical message raise this instead of adding a row.
    count: int = 1
    created_at: str
    read_at: str | None = None


class NotificationsResponse(BaseModel):
    notifications: list[NotificationRecord] = Field(default_factory=list)


class NotificationCreateRequest(BaseModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    variant: NotificationVariant


class TaggingEvent(BaseModel):
    """Broadcast when the tagger starts, stops or moves to another folder; not per file."""

    type: Literal["tagging"] = "tagging"
    status: TaggingStatusResponse


class NotificationEvent(BaseModel):
    """Job outcomes and client toasts alike; ``source`` decides which tabs raise a toast."""

    type: Literal["notification"] = "notification"
    notification: NotificationRecord


#: Machine-readable reasons the client branches on; every other error carries ``detail`` only.
type ApiErrorCode = Literal["folder_not_found"]


class ApiErrorResponse(BaseModel):
    detail: str
    code: ApiErrorCode | None = None


type ServerEvent = Annotated[
    JobEvent
    | JobsRemovedEvent
    | ExternalJobsEvent
    | HeartbeatEvent
    | FolderEvent
    | VideoEditEvent
    | VideoProjectExportEvent
    | NotificationEvent
    | TaggingEvent
    | ResyncEvent,
    Field(discriminator="type"),
]

#: Types no route mentions, so generate_types.py merges them in by hand.
EXTRA_WIRE_MODELS = (ServerEvent, JobType, JobStatus, ApiErrorResponse)

#: Runtime-checked on the client. Only unvalidated arrivals belong here; event frames are pushed.
GUARDED_WIRE_MODELS = (ServerEvent,)
