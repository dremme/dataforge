"""Find duplicate and near-duplicate media; findings go in ``.duplicate.json``, not the issue sidecar."""

from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path

from PIL import Image

from automation.job_runner import FileOutcome, ProgressCallback, ShouldCancel, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.vision import extract_video_keyframes, load_image_rgb, media_kind_for
from constants import MEDIA_EXTENSIONS
from duplicates import DuplicateFinding, group_id_for, save_duplicate_finding

logger = logging.getLogger(__name__)


THRESHOLD_DISTANCES = {"exact": 0, "near": 5, "loose": 10}

DEFAULT_THRESHOLD = "near"

HASH_SIZE = 8

# dHash sees only luminance gradients, so two flat images or a recoloured copy share a hash.
# Exact mode also compares colour, as the mean absolute 0-255 difference of small RGB copies:
# a recompressed or resized copy stays well under the tolerance, a visible recolour does not.
COLOUR_SIGNATURE_SIZE = 16
EXACT_COLOUR_TOLERANCE = 6.0


def difference_hash(image: Image.Image, size: int = HASH_SIZE) -> int:
    """A 64-bit perceptual hash of the image's luminance."""
    small = image.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    pixels = small.tobytes()

    bits = 0
    for row in range(size):
        offset = row * (size + 1)
        for column in range(size):
            bits = (bits << 1) | int(pixels[offset + column] > pixels[offset + column + 1])
    return bits


def hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def colour_signature(image: Image.Image) -> bytes:
    size = (COLOUR_SIGNATURE_SIZE, COLOUR_SIGNATURE_SIZE)
    return image.convert("RGB").resize(size, Image.Resampling.BOX).tobytes()


def colour_distance(left: bytes, right: bytes) -> float:
    return sum(abs(a - b) for a, b in zip(left, right, strict=True)) / len(left)


def _representative_frame(media_path: Path) -> tuple[Image.Image | None, str | None]:
    """A still, or a video's middle frame so opening fades do not hash unrelated clips alike."""
    if media_kind_for(media_path) != "video":
        images, error = load_image_rgb(media_path)
        if not images:
            return None, error or "Could not read image"
        return images[0], None

    frames = extract_video_keyframes(media_path, count=3)
    if frames is None or not frames.images:
        return None, "Could not decode any frame"
    return frames.images[len(frames.images) // 2], None


def _group_exact(hashes: dict[Path, int], colours: dict[Path, bytes]) -> list[list[Path]]:
    """Files with one hash, split by colour so each group looks the same. Linear in the files."""
    buckets: dict[int, list[Path]] = defaultdict(list)
    for path, value in hashes.items():
        buckets[value].append(path)

    groups: list[list[Path]] = []
    for members in buckets.values():
        clusters: list[list[Path]] = []
        for path in members:
            for cluster in clusters:
                if colour_distance(colours[cluster[0]], colours[path]) <= EXACT_COLOUR_TOLERANCE:
                    cluster.append(path)
                    break
            else:
                clusters.append([path])
        groups.extend(sorted(cluster) for cluster in clusters if len(cluster) > 1)
    return sorted(groups)


def _group_duplicates(
    hashes: dict[Path, int], max_distance: int, should_cancel: ShouldCancel | None = None
) -> list[list[Path]] | None:
    """Files grouped so every member is within ``max_distance`` of another; ``None`` if cancelled.

    Every pair is compared, so this polls ``should_cancel`` once per file.
    """
    paths = list(hashes)
    parent = {path: path for path in paths}

    def find(path: Path) -> Path:
        while parent[path] != path:
            parent[path] = parent[parent[path]]
            path = parent[path]
        return path

    def union(left: Path, right: Path) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for index, left in enumerate(paths):
        if should_cancel and should_cancel():
            return None
        for right in paths[index + 1 :]:
            if hamming_distance(hashes[left], hashes[right]) <= max_distance:
                union(left, right)

    groups: dict[Path, list[Path]] = {}
    for path in paths:
        groups.setdefault(find(path), []).append(path)

    return [sorted(group) for group in groups.values() if len(group) > 1]


def _group_max_distance(group: list[Path], hashes: dict[Path, int]) -> int:
    """The group's worst pairwise distance, not the run's threshold."""
    worst = 0
    for index, left in enumerate(group):
        for right in group[index + 1 :]:
            worst = max(worst, hamming_distance(hashes[left], hashes[right]))
    return worst


def list_find_duplicates_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def validate_find_duplicates_folder(folder: Path, *, threshold: str = DEFAULT_THRESHOLD) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if threshold not in THRESHOLD_DISTANCES:
        raise ValueError(f"Unknown duplicate threshold: {threshold}")

    if not list_find_duplicates_media(folder):
        raise ValueError("No supported images or videos found in folder")


def run_find_duplicates_job(
    folder: Path,
    *,
    threshold: str = DEFAULT_THRESHOLD,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_find_duplicates_folder(folder, threshold=threshold)

    media_files = filter_media_list(list_find_duplicates_media(folder), selected_paths)
    max_distance = THRESHOLD_DISTANCES[threshold]
    hashes: dict[Path, int] = {}
    colours: dict[Path, bytes] = {}

    def process(media_path: Path) -> FileOutcome:
        image, error = _representative_frame(media_path)
        if image is None:
            return FileOutcome.counted("read_error", error)

        hashes[media_path] = difference_hash(image)
        if max_distance == 0:
            colours[media_path] = colour_signature(image)
        return FileOutcome.counted("hashed")

    result = run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "hashed": 0,
            "duplicate": 0,
            "group": 0,
            "read_error": 0,
            "write_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
    )

    stats = result["stats"]
    if not isinstance(stats, dict):
        return result

    # Skip grouping on cancel: partial hashes would flag files unique against unseen partners.
    if stats.get("cancelled"):
        return result

    # A cancel during grouping returns before any sidecar is written, so nothing changes.
    groups = (
        _group_exact(hashes, colours)
        if max_distance == 0
        else _group_duplicates(hashes, max_distance, should_cancel)
    )
    if groups is None:
        return result

    findings: dict[Path, DuplicateFinding] = {}
    for group in groups:
        if should_cancel and should_cancel():
            return result
        finding = DuplicateFinding(
            group=group_id_for([path.name for path in group]),
            max_distance=0 if max_distance == 0 else _group_max_distance(group, hashes),
            threshold=threshold,
        )
        for path in group:
            findings[path] = finding

    # Write every hashed file so a former duplicate loses its sidecar on this run.
    for media_path in hashes:
        try:
            save_duplicate_finding(media_path, findings.get(media_path))
        except OSError as exc:
            logger.warning("Failed to write duplicate sidecar for %s: %s", media_path.name, exc)
            stats["write_error"] = stats.get("write_error", 0) + 1

    stats["duplicate"] = len(findings)
    stats["group"] = len(groups)
    return result
