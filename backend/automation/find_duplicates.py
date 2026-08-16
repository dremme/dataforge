"""Utility job that finds duplicate and near-duplicate media and flags them as caption issues.

Near-duplicate frames skew a LoRA, so the job hashes every file perceptually, groups
files whose hashes are close, and records each group in the ``.issue.json`` sidecars the
gallery already filters, badges, and steps through.

Reusing the issue sidecar buys the whole review UI for free. The file is shared with
verify-captions, so each job rewrites only the fixes it owns - this one's are the ones
prefixed with ``DUPLICATE_FIX_PREFIXES`` - and the two sets of findings coexist.

One collision remains: resolving a caption in the issue resolver deletes the whole
sidecar, dropping a duplicate finding that is still true. Re-running this job restores it.
"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable
from pathlib import Path

from PIL import Image

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.vision import extract_video_keyframes, load_image_rgb, media_kind_for
from captions import load_issue_fix_groups, save_issue_fixes
from constants import DUPLICATE_FIX_PREFIXES, MEDIA_EXTENSIONS
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

#: Mirrors ``schemas.DuplicateThreshold``. The values are Hamming distances between
#: two 64-bit hashes: 0 is pixel-identical after downscaling, 10 is a loose match.
THRESHOLD_DISTANCES = {"exact": 0, "near": 5, "loose": 10}

DEFAULT_THRESHOLD = "near"

#: Side length of the hash grid. 8 gives the 64-bit hash the distances above assume.
HASH_SIZE = 8

#: Partners named in the issue text before it collapses into a count.
MAX_NAMED_PARTNERS = 3

#: Every fix this job writes starts with one of ``DUPLICATE_FIX_PREFIXES``, which is how
#: a re-run replaces its own previous finding instead of stacking a second copy beside it,
#: and how verify-captions tells this job's findings from its own.
EXACT_FIX_PREFIX, NEAR_FIX_PREFIX = DUPLICATE_FIX_PREFIXES


def difference_hash(image: Image.Image, size: int = HASH_SIZE) -> int:
    """A 64-bit perceptual hash: each bit compares a pixel with the one to its right.

    Pillow only, deliberately - a DCT-based pHash would want numpy, which is present
    here solely as an opencv dependency and is not in ``requirements.txt``.
    """
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
    """One frame standing in for the whole file: a still, or a video's middle frame.

    Mid-clip rather than the opening frame, which is a fade or a title card often
    enough that two unrelated clips would hash alike.
    """
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
    """Files grouped so every member is within ``max_distance`` of another member.

    Union-find over the pairwise comparisons, which is quadratic in the file count.
    That is a few million integer XORs on a large folder - slow enough to notice, but
    far cheaper than the decoding pass that produced the hashes.
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
        for right in paths[index + 1 :]:
            if hamming_distance(hashes[left], hashes[right]) <= max_distance:
                union(left, right)

    groups: dict[Path, list[Path]] = {}
    for path in paths:
        groups.setdefault(find(path), []).append(path)

    return [sorted(group) for group in groups.values() if len(group) > 1]


def _duplicate_fix(media_path: Path, group: list[Path], exact: bool) -> str:
    partners = [path.name for path in group if path != media_path]
    named = partners[:MAX_NAMED_PARTNERS]
    remaining = len(partners) - len(named)
    listed = ", ".join(named)
    if remaining > 0:
        listed += f" and {remaining} more"

    prefix = EXACT_FIX_PREFIX if exact else NEAR_FIX_PREFIX
    return f"{prefix}{listed}."


def _write_duplicate_fix(media_path: Path, fix: str | None) -> None:
    """Replace this file's duplicate finding, keeping its caption findings beside it.

    The sidecar is shared with verify-captions, so a file that is no longer a duplicate
    passes ``None``, which removes the sidecar only if nothing else is on it.
    """
    _previous_duplicate_fixes, caption_fixes = load_issue_fix_groups(media_path)
    save_issue_fixes(
        media_path,
        duplicate_fixes=[fix] if fix else [],
        caption_fixes=caption_fixes,
    )


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

    # Grouping needs every hash, so it cannot run inside the per-file loop. A cancelled
    # run has only part of the folder hashed, and grouping that would flag files as
    # unique on the strength of partners that were never looked at.
    if stats.get("cancelled"):
        return result

    groups = _group_duplicates(hashes, max_distance)
    flagged = {path: group for group in groups for path in group}

    for media_path in hashes:
        group = flagged.get(media_path)
        fix = _duplicate_fix(media_path, group, exact=max_distance == 0) if group else None

        try:
            _write_duplicate_fix(media_path, fix)
        except OSError as exc:
            logger.warning("Failed to write issue sidecar for %s: %s", media_path.name, exc)
            stats["write_error"] = stats.get("write_error", 0) + 1

    stats["duplicate"] = len(flagged)
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
