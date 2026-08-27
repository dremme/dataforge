"""Find duplicate and near-duplicate media; findings go in ``.duplicate.json``, not the issue sidecar."""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable
from pathlib import Path

from PIL import Image

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.vision import extract_video_keyframes, load_image_rgb, media_kind_for
from constants import MEDIA_EXTENSIONS
from duplicates import DuplicateFinding, group_id_for, save_duplicate_finding
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

THRESHOLD_DISTANCES = {"exact": 0, "near": 5, "loose": 10}

DEFAULT_THRESHOLD = "near"

HASH_SIZE = 8


def difference_hash(image: Image.Image, size: int = HASH_SIZE) -> int:
    """A 64-bit perceptual hash; Pillow only, so numpy stays out of ``requirements.txt``."""
    small = image.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    pixels = list(small.getdata())

    bits = 0
    for row in range(size):
        offset = row * (size + 1)
        for column in range(size):
            bits = (bits << 1) | int(pixels[offset + column] > pixels[offset + column + 1])
    return bits


def hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


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


def _group_duplicates(hashes: dict[Path, int], max_distance: int) -> list[list[Path]]:
    """Files grouped so every member is within ``max_distance`` of another member."""
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

    def process(media_path: Path) -> FileOutcome:
        image, error = _representative_frame(media_path)
        if image is None:
            return FileOutcome(
                status="read_error",
                stats={"read_error": 1},
                fields={"message": error},
            )

        hashes[media_path] = difference_hash(image)
        return FileOutcome(status="hashed", stats={"hashed": 1})

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

    groups = _group_duplicates(hashes, max_distance)

    findings: dict[Path, DuplicateFinding] = {}
    for group in groups:
        finding = DuplicateFinding(
            group=group_id_for([path.name for path in group]),
            max_distance=_group_max_distance(group, hashes),
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


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Find duplicate and near-duplicate media in a folder.",
    )
    parser.add_argument("folder", type=Path, help="Folder containing images and/or videos")
    parser.add_argument(
        "--threshold",
        choices=tuple(THRESHOLD_DISTANCES),
        default=DEFAULT_THRESHOLD,
        help="How alike two files must be to count as duplicates",
    )
    args = parser.parse_args(argv)

    folder = args.folder.expanduser().resolve()
    try:
        result = run_find_duplicates_job(folder, threshold=args.threshold)
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    log_job_summary(
        logger,
        result,
        stat_keys=("hashed", "duplicate", "group", "read_error", "write_error", "cancelled"),
    )
    stats = result.get("stats") or {}
    if isinstance(stats, dict) and int(stats.get("write_error") or 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
