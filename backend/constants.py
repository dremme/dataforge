IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
GIF_EXTENSION = ".gif"
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".wmv", ".m4v", ".flv"}

# GIF straddles two axes, so neither set above is widened to hold it. It decodes
# like a still, renders in an `<img>`, and is captioned as one, but it carries a
# frame sequence the gallery scrubs and LoRA training groups with video. Reach for
# the axis a call site actually means - `automation.vision.media_kind_for` asks the
# narrower `VIDEO_EXTENSIONS`, precisely so a GIF lands on the still path.
PILLOW_EXTENSIONS = IMAGE_EXTENSIONS | {GIF_EXTENSION}
MOTION_EXTENSIONS = VIDEO_EXTENSIONS | {GIF_EXTENSION}

MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | MOTION_EXTENSIONS

# The MP4 family: containers built out of ISO base media format boxes, which is a
# narrower question than "is this a video". Anything reading a header or a metadata
# atom directly - rather than handing the file to ffmpeg - only understands these.
ISOBMFF_EXTENSIONS = {".mp4", ".mov", ".m4v"}

# Where ComfyUI writes its workflow: a PNG text chunk or an ISOBMFF metadata atom.
COMFY_WORKFLOW_EXTENSIONS = {".png"} | ISOBMFF_EXTENSIONS

# Watermarking burns text into pixels, which GIF's palette cannot express without
# visible banding, so it stays on the axes that re-encode cleanly. Video is held to
# the MP4 family for the same reason: the ffmpeg command carries `-movflags`, which
# the matroska, avi, asf and flv muxers reject, and `-c:a copy`, which they cannot
# always accept from an arbitrary source stream.
WATERMARK_EXTENSIONS = IMAGE_EXTENSIONS | ISOBMFF_EXTENSIONS

# In-place video editing re-encodes to h264/aac and carries `-movflags`, which the asf
# and flv muxers reject and which avi cannot be relied on to accept. Matroska joins the
# MP4 family here - unlike watermarking it never needs `-c:a copy` from an arbitrary
# source stream, and the muxer is named explicitly rather than guessed from the suffix.
VIDEO_EDIT_EXTENSIONS = ISOBMFF_EXTENSIONS | {".mkv"}
VIDEO_EDIT_MUXERS = {".mp4": "mp4", ".m4v": "mp4", ".mov": "mov", ".mkv": "matroska"}

# The untouched original, kept beside the edited file. Appended to the whole filename
# rather than replacing the suffix, so `clip.mp4` and `clip.mov` keep distinct backups.
VIDEO_BACKUP_SUFFIX = ".bak"

# The edit that produced the current file, so re-opening the editor shows what is
# applied. Two suffixes deep like the issue and duplicate sidecars, and read through
# `video_edit.edit_spec_path` rather than `with_suffix` for the same reason.
VIDEO_EDIT_SIDECAR_SUFFIX = ".edit.json"

# Both are appended to the full filename so the final suffix is not a media one: a temp
# file named `clip.edit-tmp.mp4` would surface as a phantom gallery item for the length
# of every render, because `folder_scan` classifies on the last suffix alone.
VIDEO_EDIT_TEMP_SUFFIX = ".edit-tmp"
VIDEO_EDIT_STALE_SUFFIX = ".edit-stale"

# Served with the file rather than guessed from it: `mimetypes.guess_type` reads the
# registry on Windows, where a machine missing a `.webp` or `.mkv` entry would fall
# through to `text/plain` and the browser would refuse to render the media at all.
MEDIA_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
}

# Caption sidecar suffixes in precedence order: a .json caption always wins over
# a .txt one, so anything resolving a media file's caption must walk this in order.
CAPTION_SIDECAR_EXTENSIONS = (".json", ".txt")
SIDECAR_EXTENSIONS = set(CAPTION_SIDECAR_EXTENSIONS)
IMPORT_EXTENSIONS = MEDIA_EXTENSIONS | SIDECAR_EXTENSIONS

# Caption issues written by verify-captions. Two suffixes deep, so `Path.stem` and
# `Path.suffix` both mis-read it; resolve names against this instead of guessing.
ISSUE_SIDECAR_SUFFIX = ".issue.json"

# Duplicate groups written by find-duplicates. Its own file rather than a share of the
# issue sidecar: a caption issue is fixed by editing text, a duplicate by deleting a file,
# so they need different resolvers and must not be able to clear each other.
DUPLICATE_SIDECAR_SUFFIX = ".duplicate.json"

# A caption is reviewed by hand, so the model is asked for the few changes that matter
# most rather than an exhaustive list. The prompt states this cap and the parser enforces it.
MAX_ISSUE_FIXES = 3

# Models answer "None" instead of returning an empty list often enough to filter for it.
ISSUE_FIX_SENTINELS = frozenset({"none", "n/a", "no issues", "no changes"})

CAPTION_BACKUP_DIR_NAME = ".backup"

# Watermarked copies land here, beside the untouched originals. Deliberately absent from
# SKIP_DIR_NAMES: the results are for the user to browse, unlike the caption backup.
WATERMARK_DIR_NAME = "watermarked"

SKIP_DIR_NAMES = {
    CAPTION_BACKUP_DIR_NAME,
    ".git",
    "node_modules",
    "__pycache__",
    "$RECYCLE.BIN",
    "$Recycle.Bin",
    "$WINDOWS.~BT",
    "$Windows.~WS",
    "System Volume Information",
    ".venv",
    "venv",
    "_latent_cache",
    "_t_e_cache",
}

LAST_FOLDER_KEY = "last_folder"

SYSPROMPT_FILENAME = ".sysprompt"

CAPTION_JSON_KEYS = (
    "high_level_description",
    "description",
    "caption",
    "caption_short",
    "text",
    "title",
    "summary",
    "prompt",
)

#: What ``scripts/generate_types.py`` emits into ``frontend/src/shared/constants.ts``.
#: Keys are the TypeScript names. Only what the UI actually needs belongs here: the
#: server re-validates every drop, so this drives affordances, never enforcement.
#: Sets are sorted for a stable diff; sequences keep their order because
#: ``CAPTION_SIDECAR_EXTENSIONS`` is a precedence list, not a bag.
SHARED_CONSTANTS: dict[str, object] = {
    "IMPORT_EXTENSIONS": sorted(IMPORT_EXTENSIONS),
    "CAPTION_SIDECAR_EXTENSIONS": list(CAPTION_SIDECAR_EXTENSIONS),
    "SYSPROMPT_FILENAME": SYSPROMPT_FILENAME,
    "VIDEO_EXTENSIONS": sorted(VIDEO_EXTENSIONS),
    "VIDEO_EDIT_EXTENSIONS": sorted(VIDEO_EDIT_EXTENSIONS),
    "GIF_EXTENSION": GIF_EXTENSION,
    "COMFY_WORKFLOW_EXTENSIONS": sorted(COMFY_WORKFLOW_EXTENSIONS),
}
