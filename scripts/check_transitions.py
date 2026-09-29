"""Check that no stylesheet transitions a background.

Run from the project root:
  backend/.venv/Scripts/python scripts/check_transitions.py

Chrome runs background-color transitions on the compositor, and one that ends while the page
is busy can flash a frame of its start. Fade the registered ``--fade-bg`` instead, through the
``fade-bg()`` mixin, which paints ``background`` from it on the main thread.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / "frontend" / "src" / "styles"

_TRANSITION = re.compile(r"\btransition(?:-property)?\s*:([^;{}]*);")
_FORBIDDEN = {"background", "background-color", "all"}
_LINE_COMMENT = re.compile(r"(?<!:)//.*$", re.M)


def _transitioned(value: str) -> list[str]:
    items, depth, current = [], 0, ""
    for char in value:
        depth += char == "("
        depth -= char == ")"
        if char == "," and depth == 0:
            items.append(current)
            current = ""
        else:
            current += char
    items.append(current)
    return [item.split()[0] for item in items if item.split()]


def problems_in(relative: str, source: str) -> list[str]:
    code = _LINE_COMMENT.sub("", source)
    found = []
    for match in _TRANSITION.finditer(code):
        for name in _transitioned(match.group(1)):
            if name in _FORBIDDEN:
                line = code.count("\n", 0, match.start()) + 1
                found.append(
                    f"{relative}:{line}: transitions {name!r}; fade --fade-bg via fade-bg() instead"
                )
    return found


def collect_problems() -> list[str]:
    found = []
    for path in sorted(STYLES.rglob("*.scss")):
        relative = path.relative_to(STYLES).as_posix()
        found.extend(problems_in(f"styles/{relative}", path.read_text(encoding="utf-8")))
    return found


def main() -> int:
    found = collect_problems()
    for problem in found:
        print(problem)
    if found:
        print(f"\n{len(found)} background transition(s).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
