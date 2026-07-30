"""Run backend and frontend linting, formatting checks, and tests.

Run from the project root:
  backend/.venv/Scripts/python scripts/run_checks.py [--fix] [--lint-only] [--scope SCOPE]

``--scope`` exists for CI, which matrixes the backend over Python versions and so
would otherwise repeat the (version-independent) frontend checks for each one.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
SCRIPTS = ROOT / "scripts"


def _python_has_ruff(python: Path) -> bool:
    result = subprocess.run(
        [str(python), "-m", "ruff", "--version"],
        cwd=BACKEND,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def _resolve_backend_venv_python() -> Path:
    candidates = [
        BACKEND / ".venv" / "Scripts" / "python.exe",
        BACKEND / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate

    print(
        "backend/.venv was not found. From the project root, create it:\n"
        "  python -m venv backend/.venv\n"
        "  backend/.venv/Scripts/pip install -r backend/requirements.txt -r backend/requirements-dev.txt",
        file=sys.stderr,
    )
    raise SystemExit(1)


def _resolve_python() -> Path:
    python = _resolve_backend_venv_python()
    if _python_has_ruff(python):
        return python

    print(
        "Dev dependencies are missing from backend/.venv. From the project root, run:\n"
        "  backend/.venv/Scripts/pip install -r backend/requirements-dev.txt",
        file=sys.stderr,
    )
    raise SystemExit(1)


def _resolve_npm() -> str:
    npm = shutil.which("npm")
    if npm:
        return npm
    if os.name == "nt":
        npm_cmd = shutil.which("npm.cmd")
        if npm_cmd:
            return npm_cmd
    raise RuntimeError("npm was not found on PATH. Install Node.js and npm first.")


def _git_status_porcelain() -> str:
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return ""
    return result.stdout


def _run_step(label: str, command: list[str], *, cwd: Path) -> None:
    print(f"\n==> {label}")
    print(f"$ {' '.join(command)}")
    result = subprocess.run(command, cwd=cwd, check=False)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def _run_fix_step(label: str, command: list[str], *, cwd: Path) -> None:
    print(f"\n==> {label}")
    print(f"$ {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=False)


def _run_fix_steps(python: Path | None, npm: str | None) -> None:
    """``None`` for either tool means that side of the stack is out of scope."""
    if python is not None:
        _run_fix_step(
            "Auto-fix backend format + lint",
            [str(python), str(SCRIPTS / "run_lint.py"), "--fix"],
            cwd=ROOT,
        )
    if npm is not None:
        _run_fix_step("Auto-fix frontend ESLint", [npm, "run", "lint:fix"], cwd=FRONTEND)
        _run_fix_step("Auto-fix frontend Prettier", [npm, "run", "format"], cwd=FRONTEND)


def _run_check_steps(python: Path | None, npm: str | None, *, lint_only: bool = False) -> None:
    """``None`` for either tool means that side of the stack is out of scope."""
    if python is not None:
        _run_step("Backend format + lint", [str(python), str(SCRIPTS / "run_lint.py")], cwd=ROOT)
    if npm is not None:
        _run_step("Frontend ESLint", [npm, "run", "lint"], cwd=FRONTEND)
        _run_step("Frontend Prettier", [npm, "run", "format:check"], cwd=FRONTEND)
    if lint_only:
        return

    if python is not None:
        _run_step("Backend tests", [str(python), str(SCRIPTS / "run_tests.py")], cwd=ROOT)
    if npm is not None:
        _run_step("Frontend tests", [npm, "test"], cwd=FRONTEND)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Auto-fix formatting and lint issues before running checks.",
    )
    parser.add_argument(
        "--lint-only",
        action="store_true",
        help="Run lint and formatting checks only (skip tests).",
    )
    parser.add_argument(
        "--scope",
        choices=("all", "backend", "frontend"),
        default="all",
        help="Limit the checks to one side of the stack (default: all).",
    )
    args = parser.parse_args()

    # Each tool is resolved only when in scope, so a backend-only run needs no
    # Node and a frontend-only run needs no backend venv.
    python = _resolve_python() if args.scope != "frontend" else None
    npm = _resolve_npm() if args.scope != "backend" else None
    auto_fixed = False

    if args.fix:
        status_before = _git_status_porcelain()
        _run_fix_steps(python, npm)
        status_after = _git_status_porcelain()
        auto_fixed = status_before != status_after

    try:
        _run_check_steps(python, npm, lint_only=args.lint_only)
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 1
        if code != 0:
            print("\nChecks failed. Fix the issues above before committing.", file=sys.stderr)
        return code

    if auto_fixed:
        print(
            "\nAuto-fixed formatting/lint issues. Stage the updated files and commit again.",
            file=sys.stderr,
        )
        return 1

    scope_label = "" if args.scope == "all" else f" ({args.scope})"
    print(f"\nAll checks passed{scope_label}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())