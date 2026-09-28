"""Check that stylesheets take every color from a theme token.

Run from the project root:
  backend/.venv/Scripts/python scripts/check_colors.py

A literal color is compiled in once, so it stays the same whichever theme is active.
Colors belong in the token files, and components read them through ``var(--...)``.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / "frontend" / "src" / "styles"
TOKENS_DIR = "tokens/"

_LITERAL = re.compile(
    r"#[0-9a-fA-F]{3,8}\b"
    r"|\b(?:rgba?|hsla?)\(\s*[\d.]"
    r"|\b(?:white|black)\b(?!-)"
)
_WHITE_SPACE_PROPERTY = re.compile(r"\bwhite-space\s*:")
_LINE_COMMENT = re.compile(r"(?<!:)//.*$")


def problems_in(relative: str, source: str) -> list[str]:
    found = []
    for number, line in enumerate(source.splitlines(), start=1):
        code = _LINE_COMMENT.sub("", line)
        code = _WHITE_SPACE_PROPERTY.sub("", code)
        match = _LITERAL.search(code)
        if match:
            found.append(
                f"{relative}:{number}: {match.group(0)!r} bypasses the theme; use a var(--...) token"
            )
    return found


def collect_problems() -> list[str]:
    found = []
    for path in sorted(STYLES.rglob("*.scss")):
        relative = path.relative_to(STYLES).as_posix()
        if relative.startswith(TOKENS_DIR):
            continue
        found.extend(problems_in(f"styles/{relative}", path.read_text(encoding="utf-8")))
    return found


def main() -> int:
    found = collect_problems()
    for problem in found:
        print(problem)
    if found:
        print(f"\n{len(found)} color(s) outside the theme tokens.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
