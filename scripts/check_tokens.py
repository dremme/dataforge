"""Check that stylesheets size type from the scale tokens.

Run from the project root:
  backend/.venv/Scripts/python scripts/check_tokens.py

A literal font size drifts off the scale and is invisible to a later retune of it. Sizes come
from ``var(--text-*)``; a file-level SCSS variable is accepted for a deliberate one-off, so
its reason sits beside its definition.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / "frontend" / "src" / "styles"
# The scales themselves are defined here.
EXEMPT_DIRS = ("abstracts/", "tokens/")

_FONT_SIZE = re.compile(r"(?<![\w$-])font-size\s*:\s*([^;{}]+);")
_ALLOWED = re.compile(r"^(?:var\(--text-[\w-]+\)|\$[\w-]+|inherit|100%)$")
_LINE_COMMENT = re.compile(r"(?<!:)//.*$")


def problems_in(relative: str, source: str) -> list[str]:
    found = []
    for number, line in enumerate(source.splitlines(), start=1):
        code = _LINE_COMMENT.sub("", line)
        for match in _FONT_SIZE.finditer(code):
            value = match.group(1).strip()
            if not _ALLOWED.match(value):
                found.append(f"{relative}:{number}: font-size {value!r}; use a var(--text-*) token")
    return found


def collect_problems() -> list[str]:
    found = []
    for path in sorted(STYLES.rglob("*.scss")):
        relative = path.relative_to(STYLES).as_posix()
        if relative.startswith(EXEMPT_DIRS):
            continue
        found.extend(problems_in(f"styles/{relative}", path.read_text(encoding="utf-8")))
    return found


def main() -> int:
    found = collect_problems()
    for problem in found:
        print(problem)
    if found:
        print(f"\n{len(found)} size(s) off the type scale.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
