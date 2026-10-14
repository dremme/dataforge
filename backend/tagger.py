"""YOLO-World tagging: open-vocabulary detections folded into one tag list per file.

``torch`` and ``ultralytics`` are optional (``requirements-tagging.txt``); without them the
background worker reports tagging as unavailable and nothing else changes.
"""

from __future__ import annotations

import functools
import hashlib
import importlib
import importlib.util
import logging
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from PIL import Image, ImageSequence

from automation.vision import extract_video_keyframes, load_image_rgb
from constants import TAG_SCORE_FLOOR
from gif_frames import keyframe_indices
from media_tags import StoredTag
from tag_vocabulary import DEFAULT_TAG_TERMS

logger = logging.getLogger(__name__)

#: The largest YOLO-World v2: on a GPU the step down saves milliseconds, not memory worth having.
GPU_MODEL_NAME = "yolov8x-worldv2.pt"

#: Without CUDA the large model takes seconds per frame; the small one keeps a video under that.
CPU_MODEL_NAME = "yolov8s-worldv2.pt"

#: The user's own terms, added after ``DEFAULT_TAG_TERMS``; ``backend/data`` is not checked in.
PERSONAL_VOCABULARY_PATH = Path(__file__).resolve().parent / "data" / "tag_vocabulary.txt"

#: Frames sampled across a video or GIF; a tag keeps its best score from any of them.
MOTION_FRAME_COUNT = 8

#: Kept per file, strongest first; the gallery filters these by the confidence setting.
MAX_TAGS_PER_FILE = 24

INFERENCE_SIZE = 640

MISSING_REQUIREMENTS = (
    "Tagging needs optional packages. Run setup again to install them, "
    "or see Tags in docs/user-guide.md."
)


def get_models_dir() -> Path:
    override = os.environ.get("DATAFORGE_MODELS_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "models"


def tagging_requirements_installed() -> bool:
    return all(importlib.util.find_spec(name) is not None for name in ("torch", "ultralytics"))


@functools.cache
def select_model_name() -> str:
    """The model this machine runs: the large one on CUDA, the small one anywhere else.

    Setup asks this too, so it downloads the model the app will load.
    """
    try:
        cuda = importlib.import_module("torch").cuda.is_available()
    except ImportError:
        cuda = False
    return GPU_MODEL_NAME if cuda else CPU_MODEL_NAME


def read_personal_terms(path: Path = PERSONAL_VOCABULARY_PATH) -> list[str]:
    """One term per line, ``#`` starts a comment; a missing file has none."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    return [line.split("#", 1)[0] for line in text.splitlines()]


def load_vocabulary(
    defaults: Iterable[str] = DEFAULT_TAG_TERMS,
    personal: Path = PERSONAL_VOCABULARY_PATH,
) -> list[str]:
    """The defaults, then the user's own terms; lowercased, spaces collapsed, without repeats."""
    terms: list[str] = []
    seen: set[str] = set()
    for raw in [*defaults, *read_personal_terms(personal)]:
        term = " ".join(raw.split()).lower()
        if term and term not in seen:
            seen.add(term)
            terms.append(term)
    return terms


def vocabulary_id(terms: Iterable[str], model_name: str) -> str:
    """Names the model and vocabulary behind a file's tags; changing either re-tags everything."""
    return hashlib.sha256("\n".join([model_name, *terms]).encode("utf-8")).hexdigest()[:16]


def fold_detections(detections: Iterable[tuple[str, float]]) -> list[StoredTag]:
    """One tag per term at its best score, strongest first."""
    best: dict[str, float] = {}
    for label, score in detections:
        if score >= TAG_SCORE_FLOOR and score > best.get(label, 0.0):
            best[label] = score
    ranked = sorted(best.items(), key=lambda entry: (-entry[1], entry[0]))
    return ranked[:MAX_TAGS_PER_FILE]


def _gif_frames(path: Path) -> list[Image.Image]:
    with Image.open(path) as image:
        total = getattr(image, "n_frames", 1)
        wanted = set(keyframe_indices(total, MOTION_FRAME_COUNT))
        return [
            frame.convert("RGB")
            for index, frame in enumerate(ImageSequence.Iterator(image))
            if index in wanted
        ]


def load_media_frames(path: Path, media_type: str) -> list[Image.Image]:
    """What the detector looks at; empty when the file cannot be decoded."""
    try:
        if media_type == "video":
            keyframes = extract_video_keyframes(path, MOTION_FRAME_COUNT)
            return [] if keyframes is None else keyframes.images
        if media_type == "gif":
            return _gif_frames(path)
        images, _error = load_image_rgb(path)
        return images or []
    except Exception:
        logger.warning("Could not read frames for tagging from %s", path.name, exc_info=True)
        return []


def _configure_ultralytics(models_dir: Path) -> None:
    """Set before the first import: ultralytics reads these once, at import time."""
    os.environ.setdefault("YOLO_CONFIG_DIR", str(models_dir))
    os.environ.setdefault("YOLO_VERBOSE", "False")
    # A missing package is reported to the user, never pip-installed behind their back.
    os.environ.setdefault("YOLO_AUTOINSTALL", "False")


class TagModel:
    """Loaded once and reused; not thread-safe, so a single worker thread owns it."""

    def __init__(self, terms: list[str], model_name: str, models_dir: Path | None = None) -> None:
        directory = models_dir or get_models_dir()
        directory.mkdir(parents=True, exist_ok=True)
        _configure_ultralytics(directory)

        # Untyped on purpose: the package is optional, so CI type-checks without it.
        yolo_world: Any = importlib.import_module("ultralytics").YOLOWorld

        self.vocabulary = vocabulary_id(terms, model_name)
        # set_classes runs CLIP over every term; a model saved with the result skips that next time.
        stem = Path(model_name).stem
        baked = directory / f"{stem}-{self.vocabulary}.pt"
        if baked.is_file():
            self._model = yolo_world(str(baked))
        else:
            # Downloaded from the ultralytics releases on first use.
            self._model = yolo_world(str(directory / model_name))
            self._model.set_classes(terms)
            self._model.save(str(baked))
            # Each is as big as the model itself; only the current vocabulary's is worth keeping.
            for stale in directory.glob(f"{stem}-*.pt"):
                if stale != baked:
                    stale.unlink(missing_ok=True)

    def tag_frames(self, frames: list[Image.Image]) -> list[StoredTag]:
        if not frames:
            return []

        results = self._model.predict(
            frames, conf=TAG_SCORE_FLOOR, imgsz=INFERENCE_SIZE, verbose=False
        )
        detections: list[tuple[str, float]] = []
        for result in results:
            names = result.names
            classes = result.boxes.cls.tolist()
            scores = result.boxes.conf.tolist()
            detections.extend(
                (names[int(cls)], float(score)) for cls, score in zip(classes, scores, strict=True)
            )
        return fold_detections(detections)

    def close(self) -> None:
        del self._model
        cuda = importlib.import_module("torch").cuda
        if cuda.is_available():
            cuda.empty_cache()
