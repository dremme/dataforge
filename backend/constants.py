IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
GIF_EXTENSION = ".gif"
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".wmv", ".m4v", ".flv"}

# GIF is still for decode/caption and motion for frames/LoRA; keep the two sets separate.
PILLOW_EXTENSIONS = IMAGE_EXTENSIONS | {GIF_EXTENSION}
MOTION_EXTENSIONS = VIDEO_EXTENSIONS | {GIF_EXTENSION}

MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | MOTION_EXTENSIONS

# Header/metadata readers only; ffmpeg accepts a wider set.
ISOBMFF_EXTENSIONS = {".mp4", ".mov", ".m4v"}

COMFY_WORKFLOW_EXTENSIONS = {".png"} | ISOBMFF_EXTENSIONS

# GIF palette cannot hold burned text; `-movflags`/`-c:a copy` only work on the MP4 family.
WATERMARK_EXTENSIONS = IMAGE_EXTENSIONS | ISOBMFF_EXTENSIONS

# Browser-decodable only: the editor reads size from `<video>`. Muxers here all accept `-movflags`.
VIDEO_EDIT_EXTENSIONS = ISOBMFF_EXTENSIONS
VIDEO_EDIT_MUXERS = {".mp4": "mp4", ".m4v": "mp4", ".mov": "mov"}

# GIF delays are per-frame, not a rate; 24 matches the rest of the video tooling.
GIF_MP4_FRAME_RATE = 24.0
GIF_MP4_EXTENSION = ".mp4"

# GIF excluded: a Pillow round-trip flattens the animation.
IMAGE_EDIT_EXTENSIONS = IMAGE_EXTENSIONS

# Appended to the whole filename so `clip.mp4` and `clip.mov` keep distinct backups.
EDIT_BACKUP_SUFFIX = ".bak"

# Two suffixes deep; read through `edit_sidecars.edit_spec_path`, not `with_suffix`.
EDIT_SIDECAR_SUFFIX = ".edit.json"

# Must not end in a media suffix or `folder_scan` would list the temp as a gallery item.
EDIT_TEMP_SUFFIX = ".edit-tmp"
EDIT_STALE_SUFFIX = ".edit-stale"

# Explicit types: Windows `mimetypes.guess_type` can fall through to `text/plain`.
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

# Only .txt is a caption; leftover Ideogram .json next to media is not.
CAPTION_SIDECAR_EXTENSIONS = (".txt",)
SIDECAR_EXTENSIONS = set(CAPTION_SIDECAR_EXTENSIONS)
IMPORT_EXTENSIONS = MEDIA_EXTENSIONS | SIDECAR_EXTENSIONS

# Two suffixes deep; `Path.stem`/`Path.suffix` both mis-read it.
ISSUE_SIDECAR_SUFFIX = ".issue.json"

# Own file so a caption-issue resolver cannot clear a duplicate finding, and vice versa.
DUPLICATE_SIDECAR_SUFFIX = ".duplicate.json"

# Prompt states this cap; the parser enforces it.
MAX_ISSUE_FIXES = 3

# Models often answer "None" instead of an empty list.
ISSUE_FIX_SENTINELS = frozenset({"none", "n/a", "no issues", "no changes"})

CAPTION_BACKUP_DIR_NAME = ".backup"

# Absent from SKIP_DIR_NAMES: the user browses these results.
WATERMARK_DIR_NAME = "watermarked"

# Same as WATERMARK_DIR_NAME: the review queue pairs candidates with sources by name.
STAGING_DIR_NAME = "staging"

# Two suffixes deep, like issue and duplicate findings.
COMFY_CANDIDATE_SIDECAR_SUFFIX = ".comfy.json"

# Not EDIT_ markers: image_edit sweeps every *.edit-tmp and would delete an in-flight accept.
COMFY_TEMP_SUFFIX = ".comfy-tmp"
COMFY_STALE_SUFFIX = ".comfy-stale"

# Image graphs only; history "gifs"/"videos" outputs are a separate contract.
COMFY_PROCESS_EXTENSIONS = IMAGE_EXTENSIONS

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

#: Emitted into ``frontend/src/shared/constants.ts``. Sets are sorted; sequences keep walk order.
SHARED_CONSTANTS: dict[str, object] = {
    "IMPORT_EXTENSIONS": sorted(IMPORT_EXTENSIONS),
    "CAPTION_SIDECAR_EXTENSIONS": list(CAPTION_SIDECAR_EXTENSIONS),
    "SYSPROMPT_FILENAME": SYSPROMPT_FILENAME,
    "VIDEO_EXTENSIONS": sorted(VIDEO_EXTENSIONS),
    "VIDEO_EDIT_EXTENSIONS": sorted(VIDEO_EDIT_EXTENSIONS),
    "IMAGE_EDIT_EXTENSIONS": sorted(IMAGE_EDIT_EXTENSIONS),
    "GIF_EXTENSION": GIF_EXTENSION,
    "GIF_MP4_FRAME_RATE": GIF_MP4_FRAME_RATE,
    "COMFY_WORKFLOW_EXTENSIONS": sorted(COMFY_WORKFLOW_EXTENSIONS),
    "STAGING_DIR_NAME": STAGING_DIR_NAME,
}
