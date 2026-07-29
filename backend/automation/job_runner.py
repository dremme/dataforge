"""Shared driver for the per-file loop every media automation job runs.

Each job supplies a function that handles one file and reports what happened;
the driver owns the parts every job must get identical: progress cadence,
cancellation accounting, and the result payload the job manager persists.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

CANCELLED = "cancelled"


@dataclass(frozen=True)
class FileOutcome:
    """What a job made of one file.

    ``stats`` are increments applied to the job's counters, ``fields`` are extra
    entries for this file's result (``description``, ``message``, ``preview``).
    Set ``stop`` to end the run without touching the remaining files.
    """

    status: str
    stats: dict[str, int] = field(default_factory=dict)
    fields: dict[str, object] = field(default_factory=dict)
    stop: bool = False


ProcessFile = Callable[[Path], FileOutcome]


def run_media_job(
    folder: Path,
    media_files: list[Path],
    *,
    stats: dict[str, int],
    process: ProcessFile,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    processed_stat_keys: tuple[str, ...] | None = None,
) -> dict[str, object]:
    """Run ``process`` over ``media_files``, reporting progress and honouring cancellation.

    ``processed_stat_keys`` sums those counters into ``processed``; omit it for
    jobs whose counters include sub-stats that must not inflate the count, and
    the number of handled files is used instead.
    """
    file_results: list[dict[str, object]] = []
    total = len(media_files)

    for index, media_path in enumerate(media_files, start=1):
        if should_cancel and should_cancel():
            stats[CANCELLED] = total - index + 1
            break

        if on_progress:
            on_progress(str(media_path), media_path.name, index - 1, total, dict(stats))

        outcome = process(media_path)

        for key, delta in outcome.stats.items():
            stats[key] = stats.get(key, 0) + delta

        file_results.append(
            {
                "path": str(media_path),
                "name": media_path.name,
                "status": outcome.status,
                **outcome.fields,
            }
        )

        if on_progress:
            on_progress(str(media_path), media_path.name, index, total, dict(stats))

        if outcome.stop:
            if outcome.status == CANCELLED:
                # This file was abandoned mid-flight; the rest are never started.
                stats[CANCELLED] = stats.get(CANCELLED, 0) + total - index
            break

    if processed_stat_keys is None:
        processed = len(file_results)
    else:
        processed = sum(stats.get(key, 0) for key in processed_stat_keys)

    return {
        "folder": str(folder),
        "total": stats["total"],
        "processed": processed,
        "stats": stats,
        "results": file_results,
    }
