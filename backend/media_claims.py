"""One registry of in-flight file mutations, so incompatible work is refused instead of overlapping.

Every writer of a media file or its sidecars claims the paths it changes for as long as it changes
them, publication and sidecar cleanup included. Whoever starts an operation claims: routes and jobs
around a render, the domain function itself for delete, rename, transfer, import and settle. A
second claim on any held path raises :class:`MediaBusyError` (a 409); nothing queues except short
caption writes, which wait up to ``wait_s``.

Claims are reentrant per thread, so an operation may call another that claims the same file.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable, Generator, Iterable
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic
from typing import Literal

from api_errors import ConflictError

type ClaimActivity = Literal[
    "render",
    "delete",
    "restore",
    "rename",
    "move",
    "import",
    "strip",
    "settle",
    "stage",
    "caption",
    "export",
]

_ACTIVITY_PHRASES: dict[ClaimActivity, str] = {
    "render": "being edited",
    "delete": "being deleted",
    "restore": "being restored",
    "rename": "being renamed",
    "move": "being moved",
    "import": "being replaced by an import",
    "strip": "having its metadata removed",
    "settle": "having its candidate settled",
    "stage": "being processed by ComfyUI",
    "caption": "having its caption saved",
    "export": "being exported",
}


class MediaBusyError(ConflictError):
    code = "media_busy"

    def __init__(self, path: Path, activity: ClaimActivity) -> None:
        super().__init__(
            f"{path.name} is {_ACTIVITY_PHRASES[activity]}. Try again when it finishes."
        )
        self.path = path
        self.activity = activity


@dataclass(eq=False)
class Claim:
    activity: ClaimActivity
    owner: int = field(default_factory=threading.get_ident)
    cancelled: threading.Event = field(default_factory=threading.Event)

    def should_cancel(self) -> bool:
        return self.cancelled.is_set()

    def cancel_check(self, also: Callable[[], bool] | None = None) -> Callable[[], bool]:
        """``should_cancel`` for work that also stops when ``also`` says so, such as its job."""
        if also is None:
            return self.should_cancel
        return lambda: self.should_cancel() or also()


_claims: dict[str, Claim] = {}
_changed = threading.Condition()


def claim_key(path: Path) -> str:
    return os.path.normcase(os.path.abspath(path))


@contextmanager
def claim(
    paths: Iterable[Path], activity: ClaimActivity, *, wait_s: float = 0.0
) -> Generator[Claim]:
    """All of ``paths`` or none. Paths this thread already holds stay with the outer claim, and a
    claim wholly inside one yields it, so a cancel reaches the work whoever started it."""
    wanted = {claim_key(path): path for path in paths}
    held = Claim(activity)
    deadline = monotonic() + wait_s

    with _changed:
        while True:
            busy = next(
                (key for key in wanted if key in _claims and _claims[key].owner != held.owner),
                None,
            )
            if busy is None:
                break
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise MediaBusyError(wanted[busy], _claims[busy].activity)
            _changed.wait(remaining)
        taken = [key for key in wanted if key not in _claims]
        for key in taken:
            _claims[key] = held
        outer = {id(_claims[key]): _claims[key] for key in wanted}
        if not taken and len(outer) == 1:
            held = next(iter(outer.values()))

    try:
        yield held
    finally:
        with _changed:
            for key in taken:
                _claims.pop(key, None)
            _changed.notify_all()


def is_claimed(path: Path) -> bool:
    with _changed:
        return claim_key(path) in _claims


def holds_claim(path: Path) -> bool:
    """Whether the calling thread holds ``path``; publication points assert it."""
    with _changed:
        held = _claims.get(claim_key(path))
        return held is not None and held.owner == threading.get_ident()


def cancel(path: Path, activity: ClaimActivity) -> bool:
    """Ask the ``activity`` holding ``path`` to stop; False if there is none."""
    with _changed:
        held = _claims.get(claim_key(path))
    if held is None or held.activity != activity:
        return False
    held.cancelled.set()
    return True
