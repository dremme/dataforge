"""Bump the patch version in the commit being made; run by the pre-commit hook.

Run from the project root:
  backend/.venv/Scripts/python scripts/bump_version.py

Only the index and the version line change, so other unstaged edits stay out of the
commit. A staged version that already differs from HEAD is kept: that is how minor and
major bumps are made, and it keeps a retried commit from bumping twice.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = "backend/pyproject.toml"

_VERSION_LINE = re.compile(rb'^version = "(\d+\.\d+\.\d+)"', re.MULTILINE)


def bumped(version: str) -> str:
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"


def _git(root: Path, *args: str, stdin: bytes | None = None) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", *args], cwd=root, input=stdin, capture_output=True)


def project_version(content: bytes) -> str:
    match = _VERSION_LINE.search(content)
    if match is None:
        raise ValueError(f"{PYPROJECT} has no version line")
    return match.group(1).decode()


def _with_version(content: bytes, version: str) -> bytes:
    return _VERSION_LINE.sub(f'version = "{version}"'.encode(), content, count=1)


def main(root: Path = ROOT) -> int:
    head = _git(root, "show", f"HEAD:{PYPROJECT}")
    if head.returncode != 0:
        return 0
    staged = _git(root, "show", f":{PYPROJECT}").stdout
    committed_version = project_version(head.stdout)
    if project_version(staged) != committed_version:
        return 0

    version = bumped(committed_version)
    blob = _git(root, "hash-object", "-w", "--stdin", stdin=_with_version(staged, version))
    blob.check_returncode()
    _git(
        root, "update-index", "--cacheinfo", f"100644,{blob.stdout.decode().strip()},{PYPROJECT}"
    ).check_returncode()

    working_tree = root / PYPROJECT
    working_tree.write_bytes(_with_version(working_tree.read_bytes(), version))
    print(f"pre-commit: version {committed_version} -> {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
