from typing import Final

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

# `-movflags`/`-c:a copy` only work on the MP4 family; GIFs take their own palette-rebuild path.
WATERMARK_EXTENSIONS = IMAGE_EXTENSIONS | ISOBMFF_EXTENSIONS | {GIF_EXTENSION}

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

MAX_RULE_FINDINGS = 5

# Models often answer "None" instead of an empty list.
ISSUE_FIX_SENTINELS = frozenset({"none", "n/a", "no issues", "no changes"})

CAPTION_BACKUP_DIR_NAME = ".backup"

# Absent from SKIP_DIR_NAMES: the user browses these results.
WATERMARK_DIR_NAME = "watermarked"

# Same as WATERMARK_DIR_NAME: the review queue pairs candidates with sources by name.
STAGING_DIR_NAME = "staging"

# ComfyUI saves PNG for stills; a candidate pairs by stem and keeps its own format on accept.
COMFY_CANDIDATE_SUFFIX = ".png"

# Order decides which staged file a source claims; every entry must be listable media.
COMFY_CANDIDATE_SUFFIXES = (COMFY_CANDIDATE_SUFFIX, ".mp4", ".mov", GIF_EXTENSION)

# Two suffixes deep, like issue and duplicate findings.
COMFY_CANDIDATE_SIDECAR_SUFFIX = ".comfy.json"

# Not EDIT_ markers: image_edit sweeps every *.edit-tmp and would delete an in-flight accept.
COMFY_TEMP_SUFFIX = ".comfy-tmp"
COMFY_STALE_SUFFIX = ".comfy-stale"

# The workflow decides what it can read; a file its loader refuses fails with ComfyUI's own error.
COMFY_PROCESS_EXTENSIONS = MEDIA_EXTENSIONS

# Any media file can hold a candidate, so the settle endpoints gate on this, not on editability.
CANDIDATE_SOURCE_EXTENSIONS = MEDIA_EXTENSIONS

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

CAPTION_RULES_FILENAME = ".captionrules"

CAPTION_EDIT_PREVIEW_LIMIT = 3

#: User-facing job names, shared so the UI and job notifications cannot drift apart.
JOB_TYPE_LABELS: dict[str, str] = {
    "auto_caption": "Auto-caption",
    "set_captions": "Set captions",
    "verify_captions": "Verify captions",
    "check_caption_rules": "Lint captions",
    "edit_captions": "Edit captions",
    "replace_captions": "Find & replace",
    "train_lora": "LoRA training",
    "batch_rename": "Rename",
    "strip_metadata": "Strip metadata",
    "find_duplicates": "Find duplicates",
    "backup_captions": "Backup captions",
    "restore_captions": "Restore captions",
    "watermark": "Watermark",
    "auto_adjust": "Auto-adjust",
    "resize": "Resize",
    "comfy_process": "Process with ComfyUI",
}

#: Adjust tools rest at 0: tones and colors span ±1, detail tools 0..1, hue is degrees.
ADJUST_MAX_HUE = 180.0

#: Curve constants of ``color_adjust``; the TS port reads the same numbers.
COLOR_ADJUST: dict[str, float] = {
    "exposure_stops": 2.0,
    "warmth_gain": 0.35,
    "tint_gain": 0.25,
    # Above 4 (lift) or 1 (crush) the shadow and highlight curves stop being monotonic.
    "shadow_lift": 2.0,
    "shadow_crush": 0.8,
    "highlight_recover": 2.0,
    "highlight_lift": 0.8,
    "brightness_gain": 0.9,
    "black_point_level": 0.2,
    "black_point_lift": 0.15,
    "white_point_level": 0.2,
    "white_point_dim": 0.15,
    "brilliance_shadows": 0.6,
    "brilliance_highlights": 0.6,
    "brilliance_contrast": 0.25,
    "tone_chroma_cap": 4.0,
}

#: Noise reduction is a self-guided filter; definition a local-contrast boost on luma.
COLOR_DETAIL: dict[str, float] = {
    "noise_luma_radius": 2,
    "noise_luma_std": 0.06,
    "noise_chroma_radius": 4,
    "noise_chroma_std": 0.12,
    "definition_short_side": 256,
    "definition_sigma": 3.84,
    "definition_gain": 1.2,
    "definition_knee": 0.15,
}

ADJUST_PREVIEW_LUT_SIZE = 33
#: Pillow's Color3DLUT stops at 65.
ADJUST_RENDER_LUT_SIZE = 65

#: The wand's dial position that applies its reading once; the far end applies it twice.
AUTO_ADJUST_DEFAULT_AMOUNT = 0.5

#: One "MP" of a resize target is 1024², the unit ComfyUI's resolution nodes use.
MEGAPIXEL = 1024 * 1024
DEFAULT_RESIZE_MEGAPIXELS = 2.0
DEFAULT_RESIZE_MULTIPLE = 32
MAX_RESIZE_MEGAPIXELS = 64.0
MAX_RESIZE_MULTIPLE = 256

#: The gallery order until the user picks one: the newest files are the ones being worked on.
DEFAULT_GALLERY_SORT: Final = "date-desc"

#: Emitted into ``frontend/src/shared/constants.ts``. Sets are sorted; sequences keep walk order.
SHARED_CONSTANTS: dict[str, object] = {
    "IMPORT_EXTENSIONS": sorted(IMPORT_EXTENSIONS),
    "CAPTION_SIDECAR_EXTENSIONS": list(CAPTION_SIDECAR_EXTENSIONS),
    "SYSPROMPT_FILENAME": SYSPROMPT_FILENAME,
    "CAPTION_RULES_FILENAME": CAPTION_RULES_FILENAME,
    "CAPTION_EDIT_PREVIEW_LIMIT": CAPTION_EDIT_PREVIEW_LIMIT,
    "VIDEO_EXTENSIONS": sorted(VIDEO_EXTENSIONS),
    "VIDEO_EDIT_EXTENSIONS": sorted(VIDEO_EDIT_EXTENSIONS),
    "IMAGE_EDIT_EXTENSIONS": sorted(IMAGE_EDIT_EXTENSIONS),
    "GIF_EXTENSION": GIF_EXTENSION,
    "GIF_MP4_FRAME_RATE": GIF_MP4_FRAME_RATE,
    "COMFY_WORKFLOW_EXTENSIONS": sorted(COMFY_WORKFLOW_EXTENSIONS),
    "STAGING_DIR_NAME": STAGING_DIR_NAME,
    "JOB_TYPE_LABELS": JOB_TYPE_LABELS,
    "ADJUST_MAX_HUE": ADJUST_MAX_HUE,
    "COLOR_ADJUST": COLOR_ADJUST,
    "COLOR_DETAIL": COLOR_DETAIL,
    "ADJUST_PREVIEW_LUT_SIZE": ADJUST_PREVIEW_LUT_SIZE,
    "AUTO_ADJUST_DEFAULT_AMOUNT": AUTO_ADJUST_DEFAULT_AMOUNT,
    "DEFAULT_GALLERY_SORT": DEFAULT_GALLERY_SORT,
    "MEGAPIXEL": MEGAPIXEL,
    "MAX_RESIZE_MEGAPIXELS": MAX_RESIZE_MEGAPIXELS,
    "MAX_RESIZE_MULTIPLE": MAX_RESIZE_MULTIPLE,
}
