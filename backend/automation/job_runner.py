"""Shared driver for the per-file loop every media automation job runs."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path

from captions import CaptionTarget, caption_targets
from media_claims import ClaimActivity, MediaBusyError, claim

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

CANCELLED = "cancelled"

#: A file another operation was changing; counted as a failure so "Retry failed" picks it up.
BUSY = "busy"


@dataclass(frozen=True)
class FileOutcome:
    """One file's result: ``stats`` increments, extra result ``fields``, and ``stop`` to abort the run."""

    status: str
    stats: dict[str, int] = field(default_factory=dict)
    fields: dict[str, object] = field(default_factory=dict)
    stop: bool = False

    @classmethod
    def counted(cls, status: str, message: object = None, **fields: object) -> FileOutcome:
        """One file under its own ``status`` counter; ``message`` is kept only when non-empty."""
        if message:
            fields["message"] = str(message)
        return cls(status=status, stats={status: 1}, fields=fields)

    @classmethod
    def cancelled(cls) -> FileOutcome:
        return cls(status=CANCELLED, stats={CANCELLED: 1}, stop=True)


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
    claim_activity: ClaimActivity | None = None,
) -> dict[str, object]:
    """Run ``process`` over ``media_files``. Omit ``processed_stat_keys`` when counters include sub-stats.

    With ``claim_activity`` each file is claimed while it is processed; a file another operation
    holds is reported as ``busy`` instead. A :class:`MediaBusyError` from inside ``process``,
    such as a caption write that found its sidecar held, is reported the same way.
    """
    file_results: list[dict[str, object]] = []
    total = len(media_files)

    for index, media_path in enumerate(media_files, start=1):
        if should_cancel and should_cancel():
            stats[CANCELLED] = total - index + 1
            break

        if on_progress:
            on_progress(str(media_path), media_path.name, index - 1, total, dict(stats))

        outcome = _process_claimed(media_path, process, claim_activity)

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


def _process_claimed(
    media_path: Path, process: ProcessFile, activity: ClaimActivity | None
) -> FileOutcome:
    try:
        if activity is None:
            return process(media_path)
        with claim([media_path], activity):
            return process(media_path)
    except MediaBusyError as exc:
        return FileOutcome.counted(BUSY, exc)


def run_caption_job(
    folder: Path,
    media_files: list[Path],
    *,
    stats: dict[str, int],
    process: Callable[[CaptionTarget], FileOutcome],
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    processed_stat_keys: tuple[str, ...] | None = None,
) -> dict[str, object]:
    """:func:`run_media_job` over captions instead of files.

    Same-stem media share one caption, so each caption is processed, backed up and counted once:
    its row is its first file's, naming the others in ``shared_with``. ``stats["total"]`` becomes
    the number of captions.
    """
    targets = {target.primary: target for target in caption_targets(media_files)}
    stats["total"] = len(targets)

    def process_primary(primary: Path) -> FileOutcome:
        target = targets[primary]
        outcome = process(target)
        if not target.shared_with:
            return outcome
        return replace(outcome, fields={**outcome.fields, "shared_with": target.shared_with})

    return run_media_job(
        folder,
        list(targets),
        stats=stats,
        process=process_primary,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=processed_stat_keys,
    )
