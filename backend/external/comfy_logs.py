"""Turn ComfyUI's raw log writes back into lines. No HTTP, no state."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

#: A 300-entry window yields 115-290 lines depending on how much each write carries, so this
#: really does trim. Well past the ~20 the panel shows, which is what scrollback needs.
LOG_TAIL_LINES = 200

_ANSI_PATTERN = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]")


def assemble_log_lines(
    entries: Iterable[Mapping[str, Any]],
    *,
    limit: int = LOG_TAIL_LINES,
) -> list[str]:
    """The window's writes as display lines, newest last, capped at ``limit``.

    Entries are stdout writes, not lines: a newline arrives as its own entry and a progress bar
    repaints itself with carriage returns.
    """
    text = "".join(entry["m"] for entry in entries if isinstance(entry.get("m"), str))

    # Before the newline pass: a `\r\x1b[K\n` repaint would otherwise keep a line-eating `\r`.
    text = _ANSI_PATTERN.sub("", text).replace("\r\n", "\n")

    # The last segment has no terminating newline: that is the bar still being drawn, and it is
    # the one line worth seeing mid-run, so it is not special-cased away.
    lines = [segment.rsplit("\r", 1)[-1].rstrip() for segment in text.split("\n")]

    # Only from the end. Interior blanks are ComfyUI's own separators and a traceback's shape.
    while lines and not lines[-1]:
        lines.pop()

    return lines[-limit:] if limit > 0 else lines
