"""Bump the patch version in the commit being made; run by the pre-commit and post-commit hooks.

Run from the project root:
  backend/.venv/Scripts/python scripts/bump_version.py pre-commit

Only the index and the version line change, so other unstaged edits stay out of the
commit. A staged version that already differs from the commit's parent is kept: that is
how minor and major bumps are made, and it keeps a retried or amended commit from bumping
twice. A version edited by hand in the working tree but left unstaged is never overwritten.

`git commit <paths>` runs pre-commit on a temporary index, so post-commit carries the
bumped version line over into the real one.
"""

from __future__ import annotations

import argparse
import re
import shlex
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = "backend/pyproject.toml"

_VERSION_LINE = re.compile(rb'^version = "(\d+\.\d+\.\d+)"', re.MULTILINE)
_GIT_OPTIONS_WITH_VALUE = frozenset(
    {"-c", "-C", "--git-dir", "--work-tree", "--namespace", "--config-env"}
)
_MAX_ALIAS_DEPTH = 10


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


def _split_subcommand(args: list[str]) -> tuple[str | None, list[str]]:
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in _GIT_OPTIONS_WITH_VALUE:
            index += 2
        elif arg.startswith("-"):
            index += 1
        else:
            return arg, args[index + 1 :]
    return None, []


def _amend_flag(commit_args: list[str]) -> bool:
    amending = False
    for arg in commit_args:
        if arg == "--":
            break
        if arg == "--amend":
            amending = True
        elif arg == "--no-amend":
            amending = False
    return amending


def amends(git_args: list[str], alias: Callable[[str], str | None]) -> bool:
    subcommand, rest = _split_subcommand(git_args)
    for _ in range(_MAX_ALIAS_DEPTH):
        if subcommand is None:
            return False
        if subcommand == "commit":
            return _amend_flag(rest)
        expansion = alias(subcommand)
        if expansion is None or expansion.startswith("!"):
            return False
        subcommand, rest = _split_subcommand([*shlex.split(expansion), *rest])
    return False


def _alias(root: Path, name: str) -> str | None:
    result = _git(root, "config", "--get", f"alias.{name}")
    return result.stdout.decode().strip() if result.returncode == 0 else None


def _git_process_args() -> list[str] | None:
    try:
        for process in psutil.Process().parents():
            if Path(process.name()).stem.lower() == "git":
                return process.cmdline()[1:]
    except psutil.Error:
        pass
    return None


def _is_amending(root: Path) -> bool:
    git_args = _git_process_args()
    return git_args is not None and amends(git_args, lambda name: _alias(root, name))


def _stage_version(root: Path, staged: bytes, version: str) -> None:
    blob = _git(root, "hash-object", "-w", "--stdin", stdin=_with_version(staged, version))
    blob.check_returncode()
    _git(
        root, "update-index", "--cacheinfo", f"100644,{blob.stdout.decode().strip()},{PYPROJECT}"
    ).check_returncode()


def bump(root: Path, *, amending: bool) -> None:
    parent = _git(root, "show", f"{'HEAD^' if amending else 'HEAD'}:{PYPROJECT}")
    if parent.returncode != 0:
        return
    parent_version = project_version(parent.stdout)
    staged = _git(root, "show", f":{PYPROJECT}").stdout
    if project_version(staged) != parent_version:
        return

    version = bumped(parent_version)
    _stage_version(root, staged, version)

    working_tree = root / PYPROJECT
    content = working_tree.read_bytes()
    if project_version(content) == parent_version:
        working_tree.write_bytes(_with_version(content, version))
    print(f"pre-commit: version {parent_version} -> {version}")


def sync_index(root: Path) -> None:
    head = _git(root, "show", f"HEAD:{PYPROJECT}")
    parent = _git(root, "show", f"HEAD^:{PYPROJECT}")
    staged = _git(root, "show", f":{PYPROJECT}")
    if head.returncode != 0 or parent.returncode != 0 or staged.returncode != 0:
        return
    head_version = project_version(head.stdout)
    parent_version = project_version(parent.stdout)
    if head_version != parent_version and project_version(staged.stdout) == parent_version:
        _stage_version(root, staged.stdout, head_version)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Bump the patch version on commit.")
    parser.add_argument("hook", choices=["pre-commit", "post-commit"])
    hook = parser.parse_args(argv).hook
    if hook == "pre-commit":
        bump(ROOT, amending=_is_amending(ROOT))
    else:
        sync_index(ROOT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
