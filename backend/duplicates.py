"""The ``.duplicate.json`` sidecar: which duplicate group a media file belongs to.

A finding records only a **group id**, never the names of the file's partners. The group
is *"every file in this folder whose sidecar carries this id"*, which is what makes the
findings survive the things that happen to a dataset between a scan and a review:

- **Renamed** - the sidecar travels with its media under the same id, so nothing to update.
- **Deleted** - the file leaves its group by no longer being there.
- **Moved out of the folder** - it becomes a lone member, which reads as resolved.

A stored member list would go stale on all three, in each case naming a file that is no
longer where the list says. The id is the only cross-file reference, and it is derived
from the group's sorted names so an unchanged group keeps its id across re-runs.
"""

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

#: Length of the hex group id. Twelve hex digits of SHA-1 over the sorted member names:
#: collision-free in any realistic folder, and short enough to read in a sidecar.
GROUP_ID_LENGTH = 12


@dataclass(frozen=True)
class DuplicateFinding:
    """One file's membership in a duplicate group."""

    group: str
    #: The group's worst pairwise Hamming distance, so ``exact`` describes the files
    #: themselves rather than the threshold the run happened to use.
    max_distance: int
    #: Which threshold produced the finding, kept for display only.
    threshold: str

    @property
    def exact(self) -> bool:
        return self.max_distance == 0


def duplicate_file_path(media_path: Path) -> Path:
    return media_path.with_suffix(DUPLICATE_SIDECAR_SUFFIX)


def group_id_for(names: list[str]) -> str:
    """A stable id for the group made up of ``names``.

    Derived rather than random so re-running the job over an unchanged folder rewrites
    the same ids, leaving the sidecars byte-identical instead of churning their mtimes.
    """
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
    # utf-8-sig, matching the caption reader: a sidecar hand-edited in Notepad picks up a
    # BOM, and plain utf-8 would reject the whole file over three leading bytes.
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
    """:func:`load_duplicate_finding` for a sidecar the caller has already stat'ed.

    The gallery listing reads one of these per file, so it goes through the same
    stat-keyed cache the caption and issue summaries use.
    """
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
    """Write the finding, or remove the sidecar when there is no longer one to record."""
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
    """Every duplicate group in ``scan``, keyed by group id and ordered by file name.

    Takes a scan rather than a folder so a caller that also needs the listing pays for
    one directory walk. ``scan_folder`` is uncached, and two walks could disagree.

    Groups left with fewer than two live members are dropped: the partners were deleted
    or moved away, so the finding is spent even though the sidecar is still on disk.
    :func:`stale_duplicate_members` reports those separately, for clearing.
    """
    groups: dict[str, list[tuple[Path, DuplicateFinding]]] = {}

    for media_path, finding in findings_in_scan(scan):
        groups.setdefault(finding.group, []).append((media_path, finding))

    return {
        group: sorted(members, key=lambda entry: entry[0].name.lower())
        for group, members in groups.items()
        if len(members) > 1
    }


def stale_duplicate_members(scan: FolderScan) -> list[Path]:
    """Files whose group has no other member left, so their sidecar says nothing."""
    findings = list(findings_in_scan(scan))

    counts: dict[str, int] = {}
    for _media_path, finding in findings:
        counts[finding.group] = counts.get(finding.group, 0) + 1

    return sorted(
        (media_path for media_path, finding in findings if counts[finding.group] < 2),
        key=lambda path: path.name.lower(),
    )


def findings_in_scan(scan: FolderScan) -> Iterator[tuple[Path, DuplicateFinding]]:
    """Every ``(media_path, finding)`` pair in ``scan``, driven by the media files.

    Media-driven rather than sidecar-driven so an orphaned ``.duplicate.json`` - its
    media gone from under it - is ignored rather than reported as a group member.
    """
    for media in scan.media:
        sidecar = scan.sidecar(media.path.stem, DUPLICATE_SIDECAR_SUFFIX)
        if sidecar is None:
            continue

        finding = duplicate_finding_from_sidecar(sidecar.path, sidecar.mtime_ns, sidecar.size)
        if finding is not None:
            yield media.path, finding
