from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Every alias here is a PEP 695 ``type`` statement rather than a plain assignment,
# which is what makes pydantic emit it as a named schema instead of inlining its
# members at each use site. ``scripts/generate_types.py`` turns those named schemas
# into the exported TypeScript unions the frontend imports.

#: Caption resolution states from ``captions.py``. ``no_caption`` is a job stat key,
#: not one of these, so do not fold it in.
type CaptionStatus = Literal["none", "empty", "text"]
type CaptionFileType = Literal["json", "txt"]

#: How an item is rendered. A GIF is its own type here because it needs an ``<img>``
#: and animates, where ``MediaKind`` folds it in with images and captions its opening
#: frame. Wider than ``MediaKind`` either way, since a sysprompt entry is listed as
#: media too.
type MediaType = Literal["image", "video", "gif", "sysprompt"]

#: Watermark appearance, mirrored by the size table in ``automation/watermark.py``.
type WatermarkSizeName = Literal["small", "medium", "large"]
type WatermarkOpacity = Literal[25, 50, 75]
# Annotated rather than a bare alias so the note reaches the generated TypeScript:
# a ``#:`` comment is invisible to pydantic, a ``Field`` description is not.
type WatermarkPosition = Annotated[
    Literal["top", "center", "bottom"],
    Field(description="top = top-left, center = middle, bottom = bottom-right."),
]

#: How the vision model is prompted: ``thinking`` lets it reason first.
type AutomationMode = Literal["thinking", "instruct"]

#: How hard the model reasons before answering, in thinking mode. The set is fixed by the
#: chat template, which raises on anything else - see ``llm-templates/qwen38_template.jinja``.
#: There is no ``high``; the template's own default is ``xhigh``, DataForge's is ``medium``.
type ReasoningEffort = Literal["low", "medium", "xhigh"]

type JobStatus = Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"]
type JobType = Literal[
    "auto_caption",
    "strip_metadata",
    "set_captions",
    "replace_captions",
    "find_duplicates",
    "verify_captions",
    "batch_rename",
    "backup_captions",
    "restore_captions",
    "train_lora",
    "watermark",
]

#: How a bulk caption edit changes each caption. ``replace`` uses the search term;
#: ``prepend`` and ``append`` ignore it and only add ``replacement``.
type CaptionReplaceMode = Literal["replace", "prepend", "append"]

#: How alike two files must be to count as duplicates. Named rather than a raw
#: distance so the wire does not depend on the hash width.
type DuplicateThreshold = Literal["exact", "near", "loose"]


class Breadcrumb(BaseModel):
    name: str
    path: str


class Subfolder(BaseModel):
    """A child folder card.

    The counts are ``None`` in a ``/api/folders/contents`` response: computing them
    means reading every caption sidecar in every child, so they are served separately
    by ``/api/folders/subfolder-stats`` and merged in once they arrive.
    """

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
    #: The duplicate group this file belongs to, or None when it is not in one. Carried
    #: on the item so a card can open the resolver at its own group; the group's
    #: membership comes from ``/api/duplicates``, never from the item.
    duplicate_group: str | None = None
    has_duplicate_file: bool = False
    caption_status: CaptionStatus
    caption_file_type: CaptionFileType | None
    media_type: MediaType
    width: int | None = None
    height: int | None = None
    size: int | None = None
    modified_at: str | None = None


class DuplicateGroup(BaseModel):
    """One set of files find-duplicates judged to be the same media.

    ``members`` is resolved fresh from the folder on every request rather than stored,
    so a group that lost a file to a delete or a move reports what is actually there.
    """

    group: str
    #: The group's worst pairwise Hamming distance. 0 means identical after downscaling.
    max_distance: int
    threshold: str
    members: list[GalleryItem]


class DuplicateGroupsResponse(BaseModel):
    folder: str
    groups: list[DuplicateGroup]
    #: Files whose group has no other member left, so their sidecar says nothing. The
    #: resolver clears these rather than presenting a group of one.
    stale: list[str] = Field(default_factory=list)
    #: Whether discarding a duplicate is recoverable. Rides on this response rather
    #: than a capability endpoint of its own because the resolver is its only reader,
    #: and it already fetches this. Required, so a new route cannot omit it and
    #: silently drop the confirmation that guards an irreversible delete.
    deletes_to_trash: bool


class DuplicateResolveRequest(BaseModel):
    #: The file to keep. Its sidecar is cleared once the rest are gone.
    keep: str
    #: The files to remove. Deleted through the same path as any other media delete,
    #: which means the Recycle Bin on Windows.
    discard: list[str]


class DuplicateResolveResponse(BaseModel):
    kept: str
    deleted: list[str]
    failed: list[str] = Field(default_factory=list)


class FolderFingerprintResponse(BaseModel):
    fingerprint: str


class FolderChangesResponse(BaseModel):
    """What changed in a folder since a given fingerprint.

    ``changed`` covers both new and edited items: the client upserts by path, so
    telling the two apart would only be work neither side needs. ``full`` means the
    delta could not be computed and the client should refetch the whole folder.
    """

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
]


class UiSettingsResponse(BaseModel):
    sort: GallerySort = "name-asc"
    show_automation_specs: bool = False


class UiSettingsUpdate(BaseModel):
    # Deliberately not ``GallerySort``: an unknown sort resets to the default
    # instead of failing the request.
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
    json_content: str | None = None
    resolve_issue: bool = False


class CaptionSaveResponse(BaseModel):
    description: str | None
    has_description: bool
    has_caption_file: bool
    caption_status: CaptionStatus
    caption_file: str = ""
    caption_file_type: CaptionFileType | None = None
    caption_content: str | None = None
    issue_fixes: list[str] = Field(default_factory=list)
    has_issue_file: bool = False


class SysPromptSaveResponse(BaseModel):
    description: str | None
    has_description: bool
    has_caption_file: bool
    caption_status: CaptionStatus
    path: str


class JobSelectionRequest(BaseModel):
    """Base of every job start: omit ``paths`` to process the whole folder."""

    paths: list[str] | None = Field(
        default=None,
        description="Optional absolute media paths to limit the job to. Omit to process the full folder.",
    )


class AutoCaptionStartRequest(JobSelectionRequest):
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


class SetCaptionsStartRequest(JobSelectionRequest):
    caption: str = ""
    overwrite: bool = False


class CaptionReplaceRequest(BaseModel):
    """The edit itself, shared by the job start and its preview.

    ``search`` and the flags are deliberately unconstrained so a refusal (an empty
    term, a regex that does not compile) comes back as the job's own 400 message
    rather than a pydantic validation blob.
    """

    mode: CaptionReplaceMode = "replace"
    search: str = ""
    replacement: str = ""
    use_regex: bool = False
    case_sensitive: bool = False


class ReplaceCaptionsStartRequest(JobSelectionRequest, CaptionReplaceRequest):
    pass


class ReplaceCaptionsPreviewRequest(JobSelectionRequest, CaptionReplaceRequest):
    pass


class CaptionReplacePreviewSample(BaseModel):
    name: str
    before: str
    after: str


class ReplaceCaptionsPreviewResponse(BaseModel):
    """What the edit would do, for the dialog to show before anything is written.

    ``error`` carries an unusable edit (bad regex, empty term) instead of a 400, so
    the dialog can show it inline while the user is still typing.
    """

    folder: str
    total: int = 0
    matched: int = 0
    samples: list[CaptionReplacePreviewSample] = Field(default_factory=list)
    error: str | None = None


class FindDuplicatesStartRequest(JobSelectionRequest):
    threshold: DuplicateThreshold = "near"


class StripMetadataStartRequest(JobSelectionRequest):
    pass


class BatchRenameStartRequest(JobSelectionRequest):
    stem: str = ""


class BackupCaptionsStartRequest(JobSelectionRequest):
    overwrite: bool = Field(
        default=False,
        description="Replace sidecars already in the backup folder instead of keeping them.",
    )


class RestoreCaptionsStartRequest(JobSelectionRequest):
    pass


class WatermarkStartRequest(JobSelectionRequest):
    # ``text`` is deliberately unconstrained so its refusal comes back as the job's own
    # 400 message rather than a pydantic validation blob.
    text: str = ""
    size: WatermarkSizeName = "medium"
    opacity: WatermarkOpacity = 50
    position: WatermarkPosition = "bottom"


class WatermarkSettingsResponse(BaseModel):
    text: str = ""
    size: WatermarkSizeName = "medium"
    opacity: WatermarkOpacity = 50
    position: WatermarkPosition = "bottom"


class WatermarkSettingsUpdate(BaseModel):
    text: str | None = None
    size: WatermarkSizeName | None = None
    opacity: WatermarkOpacity | None = None
    position: WatermarkPosition | None = None


class VerifyCaptionsSettingsResponse(BaseModel):
    mode: AutomationMode = "instruct"
    reasoning_effort: ReasoningEffort = "medium"
    preserve_thinking: bool = Field(
        default=True,
        description="Keep earlier assistant reasoning in the rendered prompt.",
    )
    context: str = ""
    folder_path: str


class VerifyCaptionsSettingsUpdate(BaseModel):
    mode: AutomationMode | None = None
    reasoning_effort: ReasoningEffort | None = None
    preserve_thinking: bool | None = None
    context: str | None = None
    folder_path: str


class VerifyCaptionsStartRequest(JobSelectionRequest):
    mode: AutomationMode = "instruct"
    reasoning_effort: ReasoningEffort = "medium"
    preserve_thinking: bool = Field(
        default=True,
        description="Keep earlier assistant reasoning in the rendered prompt.",
    )
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
    # Deliberately not ``JobType``/``JobStatus``: job history is persisted
    # (``automation/jobs_store.py``) and can hold values retired since the row was
    # written, so narrowing here would fail the whole list on one legacy row. The
    # frontend narrows instead and falls back via ``isKnownJobType``.
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
    """One job's per-file results, served separately from the job itself.

    A job holds one result per processed file and an auto-caption result carries the
    whole generated caption, so a finished run over a large folder is megabytes. The
    job list is polled while work runs; these are fetched only when something
    displays them.
    """

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


class GifInfoResponse(BaseModel):
    """How many frames one GIF holds, counted on demand.

    Kept off the listing because counting means walking the whole animation, and
    only the open frame-capture bar needs it.
    """

    frame_count: int


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
    """Shared by move and copy: only the endpoint decides whether the source survives."""

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


class JobEvent(BaseModel):
    """One job's whole current state, pushed whenever it changes."""

    type: Literal["job"] = "job"
    job: JobResponse


class ExternalJobsEvent(BaseModel):
    """The whole AI-Toolkit picture, pushed whenever the poll sees it change."""

    type: Literal["external_jobs"] = "external_jobs"
    jobs: list[ExternalOstrisJobResponse] = Field(default_factory=list)
    active_count: int = 0
    available: bool = False


class HeartbeatEvent(BaseModel):
    """Proof the stream is still alive, sent only when it has been idle.

    A real event rather than an SSE comment because a comment does not reach
    ``onmessage``, leaving a client unable to tell a working-but-quiet stream from one
    that has silently stopped delivering.
    """

    type: Literal["heartbeat"] = "heartbeat"


class FolderEvent(BaseModel):
    """A watched folder's contents changed on disk.

    Carries the new fingerprint rather than the change itself: each client diffs
    against its own baseline, so only the client can ask for a delta that is correct
    for it. ``fingerprint`` is empty when the folder became unreadable.
    """

    type: Literal["folder"] = "folder"
    path: str
    fingerprint: str = ""


#: Everything ``/api/events`` pushes.
#:
#: Every event carries a complete current snapshot of what it describes, never a delta,
#: so a client that misses one loses nothing once the next arrives.
type ServerEvent = Annotated[
    JobEvent | ExternalJobsEvent | HeartbeatEvent | FolderEvent,
    Field(discriminator="type"),
]

#: Wire types no route mentions, so ``app.openapi()`` cannot reach them on its own.
#: ``scripts/generate_types.py`` merges these in by hand. ``JobType`` and ``JobStatus``
#: are here because no model uses them: they are the narrowing the frontend applies
#: over ``JobResponse``'s deliberately loose ``str`` fields.
EXTRA_WIRE_MODELS = (ServerEvent, JobType, JobStatus)

#: Wire types the frontend checks at runtime, not just at compile time. A generated
#: guard goes into ``frontend/src/shared/wireGuards.ts`` for each of these and for
#: everything they reference.
#:
#: Only what arrives unvalidated belongs here. ``/api/events`` frames do: they are
#: pushed rather than requested, and the client parses them straight off the wire.
#: Ordinary responses do not: FastAPI has already validated them against
#: ``response_model`` on the way out, and re-checking a folder listing item by item
#: would put real work on the read path's hot loop for no new guarantee.
GUARDED_WIRE_MODELS = (ServerEvent,)
