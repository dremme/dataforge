IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
GIF_EXTENSION = ".gif"
VIDEO_EXTENSIONS = {".mp4"}

# GIF straddles two axes, so neither set above is widened to hold it. It decodes
# like a still and renders in an `<img>`, but it carries a frame sequence and so
# trains like a video. Reach for the axis a call site actually means.
PILLOW_EXTENSIONS = IMAGE_EXTENSIONS | {GIF_EXTENSION}
MOTION_EXTENSIONS = VIDEO_EXTENSIONS | {GIF_EXTENSION}

MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | MOTION_EXTENSIONS

# Watermarking burns text into pixels, which GIF's palette cannot express without
# visible banding, so it stays on the two axes that re-encode cleanly.
WATERMARK_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

# Caption sidecar suffixes in precedence order: a .json caption always wins over
# a .txt one, so anything resolving a media file's caption must walk this in order.
CAPTION_SIDECAR_EXTENSIONS = (".json", ".txt")
SIDECAR_EXTENSIONS = set(CAPTION_SIDECAR_EXTENSIONS)
IMPORT_EXTENSIONS = MEDIA_EXTENSIONS | SIDECAR_EXTENSIONS

# Caption issues written by verify-captions. Two suffixes deep, so `Path.stem` and
# `Path.suffix` both mis-read it; resolve names against this instead of guessing.
ISSUE_SIDECAR_SUFFIX = ".issue.json"

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
}
