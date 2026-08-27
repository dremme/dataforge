"""The ``.duplicate.json`` sidecar records a group id, never member names; named after the whole filename so ``clip.mp4`` and ``clip.png`` cannot share one."""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from caption_cache import cached_by_stat
from constants import DUPLICATE_SIDECAR_SUFFIX
from folder_scan import FolderScan

logger = logging.getLogger(__name__)

GROUP_ID_LENGTH = 12


@dataclass(frozen=True)
class DuplicateFinding:
    group: str
    #: Worst pairwise Hamming distance, so ``exact`` describes the files, not the threshold.
    max_distance: int
    threshold: str

    @property
    def exact(self) -> bool:
        return self.max_distance == 0


def duplicate_file_path(media_path: Path) -> Path:
    return media_path.with_name(media_path.name + DUPLICATE_SIDECAR_SUFFIX)


def group_id_for(names: list[str]) -> str:
    """Derived so a re-run over an unchanged folder rewrites the same ids."""
    joined = "\n".join(sorted(names))
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:GROUP_ID_LENGTH]


def _finding_from_data(data: object) -> DuplicateFinding | None:
    if not isinstance(data, dict):
        return None

    group = data.get("group")
    if not isinstance(group, str) or not group.strip():
        return None

    raw_distance = data.get("max_distance")
    max_distance = raw_distance if isinstance(raw_distance, int) and raw_distance >= 0 else 0
    raw_threshold = data.get("threshold")
    threshold = raw_threshold if isinstance(raw_threshold, str) else ""

    return DuplicateFinding(group=group.strip(), max_distance=max_distance, threshold=threshold)


def _finding_from_file(sidecar_path: Path) -> DuplicateFinding | None:
    # utf-8-sig: a sidecar hand-edited in Notepad picks up a BOM.
    try:
        data = json.loads(sidecar_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None

    return _finding_from_data(data)


def duplicate_finding_from_sidecar(
    sidecar_path: Path,
    mtime_ns: int,
    size: int,
) -> DuplicateFinding | None:
    """:func:`load_duplicate_finding` for a sidecar the caller has already stat'ed."""
    return cached_by_stat(
        "duplicate",
        sidecar_path,
        mtime_ns,
        size,
        lambda: _finding_from_file(sidecar_path),
    )


def load_duplicate_finding(media_path: Path) -> DuplicateFinding | None:
    sidecar_path = duplicate_file_path(media_path)
    if not sidecar_path.is_file():
        return None

    return _finding_from_file(sidecar_path)


def save_duplicate_finding(media_path: Path, finding: DuplicateFinding | None) -> None:
    sidecar_path = duplicate_file_path(media_path)

    if finding is None:
        if sidecar_path.is_file():
            sidecar_path.unlink()
        return

    payload = {
        "group": finding.group,
        "max_distance": finding.max_distance,
        "threshold": finding.threshold,
    }
    sidecar_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def delete_duplicate_file(media_path: Path) -> None:
    sidecar_path = duplicate_file_path(media_path)
    if not sidecar_path.is_file():
        return
    sidecar_path.unlink()


def group_duplicate_findings(scan: FolderScan) -> dict[str, list[tuple[Path, DuplicateFinding]]]:
    """Groups with fewer than two live members are dropped; ``scan_folder`` is uncached so two walks could disagree."""
    groups: dict[str, list[tuple[Path, DuplicateFinding]]] = {}

    for media_path, finding in findings_in_scan(scan):
        groups.setdefault(finding.group, []).append((media_path, finding))

    return {
        group: sorted(members, key=lambda entry: entry[0].name.lower())
        for group, members in groups.items()
        if len(members) > 1
    }


def stale_duplicate_members(scan: FolderScan) -> list[Path]:
    findings = list(findings_in_scan(scan))

    counts: dict[str, int] = {}
    for _media_path, finding in findings:
        counts[finding.group] = counts.get(finding.group, 0) + 1

    return sorted(
        (media_path for media_path, finding in findings if counts[finding.group] < 2),
        key=lambda path: path.name.lower(),
    )


def findings_in_scan(scan: FolderScan) -> Iterator[tuple[Path, DuplicateFinding]]:
    """Media-driven so an orphaned sidecar is ignored rather than reported as a member."""
    for media in scan.media:
        sidecar = scan.sidecar(media.name, DUPLICATE_SIDECAR_SUFFIX)
        if sidecar is None:
            continue

        finding = duplicate_finding_from_sidecar(sidecar.path, sidecar.mtime_ns, sidecar.size)
        if finding is not None:
            yield media.path, finding
