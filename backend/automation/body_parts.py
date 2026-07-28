"""Body-parts detection job: YOLO + SAM sidecar writer for Ideogram 4 .json."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from body_parts_settings import resolve_body_description, resolve_face_description
from constants import IMAGE_EXTENSIONS

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]


def _resolve_model(name: str) -> str:
    candidate = _BACKEND_DIR / name
    return str(candidate) if candidate.is_file() else name


@dataclass(frozen=True)
class _BodyPartsModelSpec:
    filename: str
    source: str
    manual_url: str


BODY_PARTS_MODEL_SPECS: tuple[_BodyPartsModelSpec, ...] = (
    _BodyPartsModelSpec(
        filename="yolo26x.pt",
        source="Ultralytics assets (ultralytics/assets)",
        manual_url="https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26x.pt",
    ),
    _BodyPartsModelSpec(
        filename="yolov8n-face.pt",
        source="derronqi/yolov8-face (Google Drive)",
        manual_url="https://drive.google.com/file/d/1qcr9DbgsX3ryrz2uU8w4Xm3cOrRywXqb/view?usp=sharing",
    ),
    _BodyPartsModelSpec(
        filename="sam3.1.pt",
        source="Meta SAM 3.1 (facebook/sam3.1, sam3.1_multiplex.pt)",
        manual_url="https://huggingface.co/facebook/sam3.1",
    ),
)


def _download_body_parts_model(spec: _BodyPartsModelSpec, target: Path) -> None:
    if spec.filename == "yolo26x.pt":
        from ultralytics.utils.downloads import safe_download

        safe_download(
            url=spec.manual_url,
            dir=target.parent,
            file=target.name,
            min_bytes=1e5,
        )
        return

    if spec.filename == "yolov8n-face.pt":
        from ultralytics.utils.downloads import safe_download

        safe_download(
            url=spec.manual_url,
            dir=target.parent,
            file=target.name,
            min_bytes=1e5,
        )
        return

    if spec.filename == "sam3.1.pt":
        import os
        import shutil

        from huggingface_hub import hf_hub_download

        hf_filename = "sam3.1_multiplex.pt"
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        cached = hf_hub_download(
            repo_id="facebook/sam3.1",
            filename=hf_filename,
            token=token,
        )
        shutil.copy2(cached, target)
        return

    raise ValueError(f"Unknown body-parts model: {spec.filename}")


def ensure_body_parts_models() -> None:
    """Ensure YOLO + SAM weights for body-parts detection are present.

    If missing, automatically downloads them from each model's upstream source
    into the backend/ directory. This runs on startup (via FastAPI lifespan in
    main.py) and before model load, so it works cross-platform without manual
    scripts or pre-bundled weights.

    Downloads are idempotent. The SAM 3.1 checkpoint (~3.5 GB) is gated on
    Hugging Face; accept the model terms and set HF_TOKEN (or
    HUGGING_FACE_HUB_TOKEN) if automatic download fails.
    """
    for spec in BODY_PARTS_MODEL_SPECS:
        target = _BACKEND_DIR / spec.filename
        if target.is_file():
            continue

        logger.info(
            "Body-parts model %s missing; downloading from %s ... (this may take a while)",
            spec.filename,
            spec.source,
        )
        target.parent.mkdir(parents=True, exist_ok=True)

        try:
            _download_body_parts_model(spec, target)
            size = target.stat().st_size
            logger.info("Successfully downloaded %s (%d bytes)", spec.filename, size)
        except Exception as exc:
            if target.exists():
                with suppress(Exception):
                    target.unlink()
            logger.exception("Failed to download %s", spec.filename)
            manual_hint = (
                f"Manual download: {spec.manual_url}\n"
                if spec.filename != "sam3.1.pt"
                else (
                    f"Manual download: {spec.manual_url}\n"
                    "  1. Accept the model terms on Hugging Face\n"
                    "  2. Download sam3.1_multiplex.pt\n"
                    "  3. Save it as sam3.1.pt\n"
                    "  Or set HF_TOKEN / HUGGING_FACE_HUB_TOKEN for automatic download.\n"
                )
            )
            raise RuntimeError(
                f"Failed to auto-download body-parts model {spec.filename} "
                f"from {spec.source}.\n"
                f"{manual_hint}"
                f"Place the file at: {target}\n"
                f"Error: {exc}"
            ) from exc


def list_body_parts_images(folder: Path) -> list[Path]:
    images: list[Path] = []
    try:
        entries = sorted(folder.iterdir(), key=lambda path: path.name.lower())
    except OSError:
        return []

    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        images.append(entry)

    return images


def validate_body_parts_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_body_parts_images(folder):
        raise ValueError("No supported images found in folder")


def build_body_part_elements(
    *,
    body_bbox: list[float] | None,
    face_bbox: list[float] | None,
    semantic_bbox: list[float] | None,
    body_desc: str = "",
    face_desc: str = "",
    semantic_desc: str = "",
) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []

    if body_bbox:
        elements.append(
            {
                "type": "obj",
                "bbox": [round(value, 0) for value in body_bbox],
                "desc": resolve_body_description(body_desc),
            }
        )
    if face_bbox:
        elements.append(
            {
                "type": "obj",
                "bbox": [round(value, 0) for value in face_bbox],
                "desc": resolve_face_description(face_desc),
            }
        )
    if semantic_bbox and semantic_desc.strip():
        elements.append(
            {
                "type": "obj",
                "bbox": [round(value, 0) for value in semantic_bbox],
                "desc": semantic_desc.strip(),
            }
        )

    return elements


def write_body_parts_sidecar(
    img_path: Path, elements: list[dict[str, Any]]
) -> tuple[str, str | None]:
    """Write or patch an Ideogram 4 .json sidecar.

    Returns (status, message) where status is created, updated, or write_error.
    """
    json_path = img_path.with_suffix(".json")

    if json_path.exists():
        try:
            with json_path.open(encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Could not parse existing %s, recreating: %s", json_path.name, exc)
            data = {}

        if not isinstance(data, dict):
            data = {}

        decon = data.get("compositional_deconstruction")
        if not isinstance(decon, dict):
            decon = {}
        decon["elements"] = elements
        data["compositional_deconstruction"] = decon
        status = "updated"
    else:
        data = {
            "compositional_deconstruction": {
                "elements": elements,
            },
        }
        status = "created"

    try:
        with json_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
    except OSError as exc:
        return "write_error", str(exc)

    return status, None


@dataclass
class BodyPartsModels:
    body_model: Any
    face_model: Any
    semantic_predictor: Any | None


def _require_gpu() -> Any:
    import torch
    import torchvision

    if not torch.cuda.is_available():
        raise RuntimeError(
            "Body parts detection requires CUDA. "
            "Install GPU PyTorch and torchvision from https://pytorch.org/get-started/locally/"
        )
    if "+cpu" in torchvision.__version__.lower():
        raise RuntimeError(
            "torchvision is CPU-only; install the CUDA build from the same wheel index as torch."
        )
    return torch.device("cuda")


def load_body_parts_models() -> BodyPartsModels:
    import torch
    from ultralytics import YOLO
    from ultralytics.models.sam import SAM3SemanticPredictor

    ensure_body_parts_models()

    device = _require_gpu()

    # Reduce chance of fragmentation from prior allocations (other jobs, previous runs, etc.).
    torch.cuda.empty_cache()
    with suppress(Exception):
        torch.cuda.synchronize()

    if torch.cuda.is_available():
        try:
            free_bytes, total_bytes = torch.cuda.mem_get_info()
            logger.info(
                "Loading body-parts models on %s (%.1f GB free of %.1f GB)",
                device,
                free_bytes / (1024**3),
                total_bytes / (1024**3),
            )
        except Exception:
            logger.info("Loading body-parts models on %s", device)
    else:
        logger.info("Loading body-parts models on %s", device)

    body_model = YOLO(_resolve_model("yolo26x.pt"))
    body_model.overrides["imgsz"] = 640
    # Use FP16 to cut weight memory roughly in half for the large body detector.
    if hasattr(body_model, "model") and hasattr(body_model.model, "half"):
        body_model.model.half()
    body_model.to(device)

    face_model = YOLO(_resolve_model("yolov8n-face.pt"))
    face_model.overrides["imgsz"] = 640
    if hasattr(face_model, "model") and hasattr(face_model.model, "half"):
        face_model.model.half()
    face_model.to(device)

    semantic_predictor = SAM3SemanticPredictor(
        overrides={
            "conf": 0.25,
            "task": "segment",
            "mode": "predict",
            "model": _resolve_model("sam3.1.pt"),
            "imgsz": 1008,
            "verbose": False,
            "save": False,
            "half": True,
            "device": "cuda",
        }
    )

    return BodyPartsModels(
        body_model=body_model,
        face_model=face_model,
        semantic_predictor=semantic_predictor,
    )


def _largest_confident_box(
    results: Any, *, confidence_threshold: float = 0.25
) -> list[float] | None:
    import numpy as np

    if len(results.boxes) == 0:
        return None

    boxes = results.boxes.xyxy.cpu().numpy()
    confs = results.boxes.conf.cpu().numpy()
    mask = confs > confidence_threshold
    if not np.any(mask):
        return None

    filtered = boxes[mask]
    areas = (filtered[:, 2] - filtered[:, 0]) * (filtered[:, 3] - filtered[:, 1])
    return filtered[np.argmax(areas)].tolist()


def detect_semantic_regions(
    semantic_predictor: Any | None,
    cv_img: Any,
    prompts: list[str],
) -> list[list[float]]:
    if semantic_predictor is None or cv_img is None or not prompts:
        return []

    import numpy as np
    import torch

    try:
        semantic_predictor.set_image(cv_img)
        results = semantic_predictor(text=prompts)

        if isinstance(results, list):
            results = results[0] if results else None
        if results is None:
            return []

        boxes_list: list[list[float]] = []

        if hasattr(results, "boxes") and results.boxes is not None:
            try:
                if hasattr(results.boxes, "xyxy"):
                    boxes_np = results.boxes.xyxy.cpu().numpy()
                else:
                    boxes_np = np.asarray(results.boxes)
                if boxes_np.size > 0:
                    if boxes_np.ndim == 1:
                        boxes_np = boxes_np.reshape(1, -1)
                    boxes_list.extend([[float(value) for value in box[:4]] for box in boxes_np])
            except Exception:
                pass

        if not boxes_list and hasattr(results, "masks") and results.masks is not None:
            try:
                masks = results.masks
                if hasattr(masks, "cpu"):
                    masks = masks.cpu().numpy()
                elif torch.is_tensor(masks):
                    masks = masks.numpy()

                for mask in masks:
                    if mask.ndim == 3:
                        mask = mask[0]
                    ys, xs = np.where(mask > 0.5)
                    if len(xs) > 0 and len(ys) > 0:
                        boxes_list.append(
                            [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]
                        )
            except Exception as exc:
                logger.debug("Mask to box conversion error: %s", exc)

        return boxes_list
    except Exception as exc:
        logger.warning("SAM semantic detection error: %s", exc)
        return []
    finally:
        if hasattr(semantic_predictor, "reset_image"):
            with suppress(Exception):
                semantic_predictor.reset_image()


def detect_body_parts_for_image(
    models: BodyPartsModels,
    img_path: Path,
    *,
    body_description: str = "",
    face_description: str = "",
    keywords: list[str] | None = None,
    element_description: str = "",
) -> list[dict[str, Any]]:
    import cv2
    import numpy as np

    cv_img = cv2.imread(str(img_path))
    if cv_img is None:
        raise ValueError(f"Could not read image: {img_path.name}")

    body_results = models.body_model(cv_img, classes=[0], verbose=False)[0]
    body_bbox = _largest_confident_box(body_results)

    face_results = models.face_model(cv_img, verbose=False)[0]
    face_bbox = _largest_confident_box(face_results)

    semantic_bbox: list[float] | None = None
    if keywords:
        semantic_results = detect_semantic_regions(models.semantic_predictor, cv_img, keywords)
        if semantic_results:
            arr = np.asarray(semantic_results)
            semantic_bbox = [
                float(arr[:, 0].min()),
                float(arr[:, 1].min()),
                float(arr[:, 2].max()),
                float(arr[:, 3].max()),
            ]

    return build_body_part_elements(
        body_bbox=body_bbox,
        face_bbox=face_bbox,
        semantic_bbox=semantic_bbox,
        body_desc=body_description,
        face_desc=face_description,
        semantic_desc=element_description,
    )


def free_vram(models: BodyPartsModels):
    import gc

    try:
        import torch
    except ImportError:
        # No torch in this environment (e.g. test runner without GPU extras or CPU-only install).
        # Just do Python GC; there is no CUDA state to release.
        for _ in range(3):
            gc.collect()
        return

    for attr in ("body_model", "face_model", "semantic_predictor"):
        m = getattr(models, attr, None)
        if m is None:
            continue

        try:
            # SAM3SemanticPredictor specific
            if hasattr(m, "reset_image"):
                with suppress(Exception):
                    m.reset_image()

            for cache_attr in (
                "features",
                "image_embedding",
                "original_size",
                "input_size",
                "transformed_image",
            ):
                if hasattr(m, cache_attr):
                    setattr(m, cache_attr, None)

            if hasattr(m, "model"):
                try:
                    if hasattr(m.model, "to"):
                        m.model.to("cpu")
                    del m.model
                except Exception:
                    pass

            # YOLO models
            if hasattr(m, "model"):
                try:
                    if hasattr(m.model, "to"):
                        m.model.to("cpu")
                    del m.model
                except Exception:
                    pass

            if hasattr(m, "predictor"):
                m.predictor = None

            if hasattr(m, "to"):
                m.to("cpu")

        except Exception:
            pass

        with suppress(Exception):
            delattr(models, attr)

    del models

    for _ in range(3):
        gc.collect()

    # CI and CPU-only installs have torch without a usable NVIDIA driver.
    if not torch.cuda.is_available():
        return

    for _ in range(3):
        torch.cuda.empty_cache()

    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    torch.cuda.reset_accumulated_memory_stats()


def run_body_parts_job(
    folder: Path,
    *,
    body_description: str = "",
    face_description: str = "",
    keywords: list[str] | None = None,
    element_description: str = "",
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    model_loader: Callable[[], BodyPartsModels] | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    from automation.selection import filter_media_list

    validate_body_parts_folder(folder)

    image_files = filter_media_list(list_body_parts_images(folder), selected_paths)
    stats: dict[str, int] = {
        "total": len(image_files),
        "success": 0,
        "created": 0,
        "updated": 0,
        "read_error": 0,
        "write_error": 0,
        "detection_error": 0,
        "no_detections": 0,
        "cancelled": 0,
    }
    file_results: list[dict[str, object]] = []
    total = len(image_files)

    loader = model_loader or load_body_parts_models

    if on_progress:
        on_progress("", "Loading models...", 0, total, dict(stats))

    if should_cancel and should_cancel():
        stats["cancelled"] = total
        return {
            "folder": str(folder),
            "total": stats["total"],
            "processed": 0,
            "stats": stats,
            "results": [],
        }

    try:
        models = loader()
    except Exception as exc:
        msg = str(exc)
        if (
            "out of memory" in msg.lower()
            or "CUDA out of memory" in msg
            or "cudaErrorMemoryAllocation" in msg
        ):
            raise RuntimeError(
                "Failed to load body-parts models: CUDA out of memory. "
                "The YOLO + SAM models (especially sam3.1.pt) require several GB of VRAM. "
                "Close other GPU applications (browsers with many tabs, games, ComfyUI, etc.), "
                "run 'nvidia-smi' to check current usage, reboot if necessary after a driver update, "
                "and ensure you are using a recent CUDA-enabled PyTorch build compatible with your driver and RTX 50-series GPU. "
                f"Original error: {exc}"
            ) from exc
        raise RuntimeError(f"Failed to load body-parts models: {exc}") from exc

    for index, img_path in enumerate(image_files, start=1):
        if should_cancel and should_cancel():
            stats["cancelled"] = total - index + 1
            break

        if on_progress:
            on_progress(str(img_path), img_path.name, index - 1, total, dict(stats))

        result: dict[str, object] = {
            "path": str(img_path),
            "name": img_path.name,
            "status": "success",
        }

        try:
            elements = detect_body_parts_for_image(
                models,
                img_path,
                body_description=body_description,
                face_description=face_description,
                keywords=keywords,
                element_description=element_description,
            )
            if not elements:
                stats["no_detections"] += 1

            status, message = write_body_parts_sidecar(img_path, elements)
            result["status"] = status

            if status == "created":
                stats["success"] += 1
                stats["created"] += 1
            elif status == "updated":
                stats["success"] += 1
                stats["updated"] += 1
            else:
                stats["write_error"] += 1
                result["message"] = message
        except ValueError as exc:
            stats["read_error"] += 1
            result["status"] = "read_error"
            result["message"] = str(exc)
        except Exception as exc:
            stats["detection_error"] += 1
            result["status"] = "detection_error"
            result["message"] = str(exc)
            logger.error("Body parts detection error for %s: %s", img_path.name, exc)

        file_results.append(result)

        if on_progress:
            on_progress(str(img_path), img_path.name, index, total, dict(stats))

    # Each handled file is counted once in file_results. no_detections is a
    # sub-stat of successful runs and must not be summed into processed.
    processed = len(file_results)

    free_vram(models)

    return {
        "folder": str(folder),
        "total": stats["total"],
        "processed": processed,
        "stats": stats,
        "results": file_results,
    }
