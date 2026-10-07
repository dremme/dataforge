"""Run backend and frontend linting, formatting checks, typechecking, and tests.

Run from the project root:
  backend/.venv/Scripts/python scripts/run_checks.py [--fix] [--lint-only] [--scope SCOPE]

A passing step is one line. A failing step prints everything it wrote, and the run stops there.
Lint and type warnings fail their step. Warnings raised while tests pass are only counted;
``run_tests.py -v`` or ``npm test`` shows them.

``--scope`` exists for CI, which matrixes the backend over Python versions and so
would otherwise repeat the (version-independent) frontend checks for each one.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Mapping
from dataclasses import astuple, dataclass
from pathlib import Path
from typing import Any, TextIO

# Subprocesses use this interpreter; failing here names the cause, not pytest's SyntaxError.
from py_version import require_python

require_python()

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
SCRIPTS = ROOT / "scripts"

ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")
BACKEND_TEST_COUNT = re.compile(r"^Ran (\d+) tests? in", re.MULTILINE)
FRONTEND_TEST_COUNT = re.compile(r"^\s*Tests\s.*\((\d+)\)\s*$", re.MULTILINE)
PROGRESS_MARKER = re.compile(r"@progress (\d+)/(\d+)\n?")
WARNINGS_MARKER = re.compile(r"@warnings (\d+)\n?")
PROGRESS_ENV = "DATAFORGE_PROGRESS"
COVERAGE_ENV = "DATAFORGE_COVERAGE_DIR"
BACKEND_COVERAGE_FILE = "backend.json"
FRONTEND_COVERAGE_FILE = "frontend/coverage-summary.json"
BAR_WIDTH = 20

AUTO_FIX_LABEL = "Auto-fix"

BOLD = "1"
DIM = "2"
RED = "31"
GREEN = "32"
YELLOW = "33"


@dataclass(frozen=True)
class Glyphs:
    passed: str
    failed: str
    running: str
    bar_filled: str
    bar_empty: str


FANCY_GLYPHS = Glyphs(passed="✓", failed="✗", running="·", bar_filled="█", bar_empty="░")
PLAIN_GLYPHS = Glyphs(passed="+", failed="x", running=">", bar_filled="#", bar_empty="-")


@dataclass(frozen=True)
class Step:
    label: str
    command: list[str]
    cwd: Path = ROOT
    test_count: re.Pattern[str] | None = None

    @property
    def shown_command(self) -> str:
        executable = Path(self.command[0]).stem
        return " ".join([executable, *(_relative(argument) for argument in self.command[1:])])

    @property
    def shown_location(self) -> str:
        return "" if self.cwd == ROOT else f"{self.cwd.relative_to(ROOT).as_posix()}/"


@dataclass(frozen=True)
class Outcome:
    returncode: int
    output: str
    seconds: float
    warnings: int = 0


@dataclass(frozen=True)
class CoverageTotals:
    covered: int
    total: int

    @property
    def percent(self) -> float:
        return 100 * self.covered / self.total if self.total else 100.0


class Console:
    def __init__(
        self,
        stream: TextIO,
        *,
        color: bool,
        live: bool,
        glyphs: Glyphs,
        label_width: int,
    ) -> None:
        # Step output is arbitrary text; a cp1252 console must not crash before showing it.
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(errors="replace")
        self._stream = stream
        self.color = color
        self.live = live
        self._glyphs = glyphs
        self._label_width = label_width
        self._pending_width = 0
        self._percent = -1

    @classmethod
    def detect(cls, stream: TextIO, environ: Mapping[str, str], *, label_width: int) -> Console:
        interactive = stream.isatty() and environ.get("TERM") != "dumb"
        forced = environ.get("FORCE_COLOR", "0") not in ("", "0")
        color = "NO_COLOR" not in environ and (interactive or forced)
        fancy = _can_encode(stream, "".join(astuple(FANCY_GLYPHS)))
        return cls(
            stream,
            color=color,
            live=interactive,
            glyphs=FANCY_GLYPHS if fancy else PLAIN_GLYPHS,
            label_width=label_width,
        )

    def running(self, label: str) -> None:
        if not self.live:
            return
        self._percent = -1
        text = f"  {self._glyphs.running} {label}..."
        self._redraw(text, self._paint(text, DIM))

    def progress(self, label: str, fraction: float) -> None:
        percent = min(100, max(0, int(fraction * 100)))
        if not self.live or percent == self._percent:
            return
        self._percent = percent
        filled = percent * BAR_WIDTH // 100
        head = f"  {self._glyphs.running} {label.ljust(self._label_width)}  "
        done = self._glyphs.bar_filled * filled
        todo = self._glyphs.bar_empty * (BAR_WIDTH - filled)
        tail = f"  {percent:>3}%"
        painted = (
            self._paint(head, DIM)
            + self._paint(done, GREEN)
            + self._paint(todo, DIM)
            + self._paint(tail, DIM)
        )
        self._redraw(head + done + todo + tail, painted)

    def finished(
        self,
        label: str,
        *,
        passed: bool,
        seconds: float,
        detail: str = "",
        warnings: int = 0,
    ) -> None:
        self._clear_pending()
        glyph = (
            self._paint(self._glyphs.passed, GREEN)
            if passed
            else self._paint(self._glyphs.failed, RED)
        )
        line = f"  {glyph} {label.ljust(self._label_width)}"
        line += "  " + self._paint(_format_duration(seconds).rjust(6), DIM)
        if detail:
            line += "  " + self._paint(detail, DIM)
        if warnings:
            line += self._paint(", ", DIM) if detail else "  "
            line += self._paint(_plural(warnings, "warning"), YELLOW)
        self._write(line)

    def failure(self, step: Step, outcome: Outcome) -> None:
        where = f"{step.shown_location}, " if step.shown_location else ""
        header = f"  $ {step.shown_command}  ({where}exit {outcome.returncode})"
        self._write("")
        self._write(self._paint(header, DIM))
        self._write("")
        output = outcome.output.strip("\n")
        if output:
            self._write(output)

    def coverage(self, results: Mapping[str, CoverageTotals | None]) -> None:
        self._write("")
        width = max(map(len, results))
        for index, (side, totals) in enumerate(results.items()):
            title = "Coverage" if index == 0 else ""
            if totals is None:
                figures = self._paint("no data", DIM)
            else:
                percent = self._paint(f"{totals.percent:.1f}%".rjust(6), BOLD)
                lines = f"{totals.covered:,} of {totals.total:,} lines"
                figures = f"{percent}  {self._paint(lines, DIM)}"
            self._write(f"  {title:<8}  {side.ljust(width)}  {figures}")

    def message(self, text: str, *styles: str) -> None:
        self._write("")
        self.line(text, *styles)

    def line(self, text: str, *styles: str) -> None:
        self._write(self._paint(text, *styles))

    def _redraw(self, plain: str, painted: str) -> None:
        padding = " " * max(0, self._pending_width - len(plain))
        self._write("\r" + painted + padding, end="")
        self._pending_width = max(self._pending_width, len(plain))

    def _clear_pending(self) -> None:
        if self._pending_width:
            self._write("\r" + " " * self._pending_width + "\r", end="")
            self._pending_width = 0

    def _paint(self, text: str, *styles: str) -> str:
        if not self.color:
            return text
        return f"\x1b[{';'.join(styles)}m{text}\x1b[0m"

    def _write(self, text: str, *, end: str = "\n") -> None:
        print(text, end=end, file=self._stream, flush=True)


def _can_encode(stream: TextIO, text: str) -> bool:
    try:
        text.encode(getattr(stream, "encoding", None) or "ascii")
    except (UnicodeEncodeError, LookupError):
        return False
    return True


def _relative(argument: str) -> str:
    path = Path(argument)
    if path.is_absolute() and path.is_relative_to(ROOT):
        return path.relative_to(ROOT).as_posix()
    return argument


def _format_duration(seconds: float) -> str:
    if round(seconds, 1) < 60:
        return f"{seconds:.1f}s"
    minutes, remainder = divmod(round(seconds), 60)
    return f"{minutes}m {remainder:02d}s"


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _backend_totals(report: dict[str, Any]) -> CoverageTotals:
    totals = report["totals"]
    return CoverageTotals(totals["covered_lines"], totals["num_statements"])


def _frontend_totals(report: dict[str, Any]) -> CoverageTotals:
    lines = report["total"]["lines"]
    return CoverageTotals(lines["covered"], lines["total"])


def _read_totals(
    path: Path, extract: Callable[[dict[str, Any]], CoverageTotals]
) -> CoverageTotals | None:
    try:
        return extract(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _collect_coverage(
    directory: Path, *, backend: bool, frontend: bool
) -> dict[str, CoverageTotals | None]:
    results: dict[str, CoverageTotals | None] = {}
    if backend:
        results["backend"] = _read_totals(directory / BACKEND_COVERAGE_FILE, _backend_totals)
    if frontend:
        results["frontend"] = _read_totals(directory / FRONTEND_COVERAGE_FILE, _frontend_totals)
    return results


def _child_environment(
    base: Mapping[str, str],
    *,
    color: bool,
    progress: bool,
    coverage_dir: Path | None = None,
) -> dict[str, str]:
    dropped = ("FORCE_COLOR", "NO_COLOR", PROGRESS_ENV, COVERAGE_ENV)
    environ = {key: value for key, value in base.items() if key not in dropped}
    environ["FORCE_COLOR" if color else "NO_COLOR"] = "1"
    if progress:
        environ[PROGRESS_ENV] = "1"
    if coverage_dir is not None:
        environ[COVERAGE_ENV] = str(coverage_dir)
    environ["NPM_CONFIG_LOGLEVEL"] = "silent"
    environ["PYTHONIOENCODING"] = "utf-8"
    return environ


def _enable_windows_ansi() -> None:
    if os.name == "nt":
        # An empty command is enough to switch a legacy console into escape-sequence mode.
        os.system("")


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


def _git_status_lines() -> list[str]:
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return result.stdout.splitlines()


def _changed_status(before: list[str], after: list[str]) -> list[str]:
    return [line for line in after if line not in before]


def _fix_commands(python: Path | None, npm: str | None) -> list[tuple[list[str], Path]]:
    """``None`` for either tool means that side of the stack is out of scope."""
    commands: list[tuple[list[str], Path]] = []
    if python is not None:
        commands.append(([str(python), str(SCRIPTS / "run_lint.py"), "--fix"], ROOT))
    if npm is not None:
        commands.append(([npm, "run", "lint:fix"], FRONTEND))
        commands.append(([npm, "run", "format"], FRONTEND))
    return commands


def _check_steps(
    python: Path | None,
    npm: str | None,
    *,
    interpreter: Path,
    scope: str,
    lint_only: bool = False,
) -> list[Step]:
    """``None`` for either tool means that side of the stack is out of scope."""
    steps: list[Step] = []
    if python is not None:
        steps.append(Step("Backend format + lint", [str(python), str(SCRIPTS / "run_lint.py")]))
        # Grouped with static checks for the same reason as the frontend typecheck below.
        steps.append(Step("Backend typecheck", [str(python), str(SCRIPTS / "run_typecheck.py")]))
    if npm is not None:
        steps.append(Step("Frontend ESLint", [npm, "run", "lint"], FRONTEND))
        steps.append(Step("Frontend Prettier", [npm, "run", "format:check"], FRONTEND))
        # Grouped with static checks so ``--lint-only`` still catches type errors; vitest does not.
        steps.append(Step("Frontend typecheck", [npm, "run", "typecheck"], FRONTEND))
        steps.append(Step("Theme colors", [str(interpreter), str(SCRIPTS / "check_colors.py")]))
        steps.append(
            Step(
                "Background transitions",
                [str(interpreter), str(SCRIPTS / "check_transitions.py")],
            )
        )
    steps.append(
        Step(
            "Comments",
            [str(interpreter), str(SCRIPTS / "check_comments.py"), "--scope", scope],
        )
    )
    if lint_only:
        return steps

    if python is not None:
        steps.append(
            Step(
                "Backend tests",
                [str(python), str(SCRIPTS / "run_tests.py")],
                test_count=BACKEND_TEST_COUNT,
            )
        )
    if npm is not None:
        steps.append(
            Step(
                "Frontend tests",
                [npm, "test", "--", "--reporter=dot", "--reporter=./vitest.progress.ts"],
                FRONTEND,
                test_count=FRONTEND_TEST_COUNT,
            )
        )
    return steps


def _capture(
    step: Step,
    environ: Mapping[str, str],
    on_progress: Callable[[float], None] | None = None,
) -> Outcome:
    started = time.monotonic()
    chunks: list[str] = []
    warnings = 0
    with subprocess.Popen(
        step.command,
        cwd=step.cwd,
        env=dict(environ),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    ) as process:
        try:
            for line in process.stdout or ():
                marker = PROGRESS_MARKER.search(line)
                if marker:
                    line = line[: marker.start()] + line[marker.end() :]
                    if on_progress is not None and int(marker[2]) > 0:
                        on_progress(int(marker[1]) / int(marker[2]))
                counted = WARNINGS_MARKER.search(line)
                if counted:
                    line = line[: counted.start()] + line[counted.end() :]
                    warnings += int(counted[1])
                chunks.append(line)
        except BaseException:
            process.kill()
            raise
    return Outcome(process.returncode, "".join(chunks), time.monotonic() - started, warnings)


def _detail(step: Step, output: str) -> str:
    if step.test_count is None:
        return ""
    match = step.test_count.search(ANSI_ESCAPE.sub("", output))
    return _plural(int(match[1]), "test") if match else ""


def _execute(console: Console, step: Step, environ: Mapping[str, str]) -> bool:
    console.running(step.label)
    outcome = _capture(step, environ, lambda fraction: console.progress(step.label, fraction))
    passed = outcome.returncode == 0
    detail = _detail(step, outcome.output) if passed else ""
    console.finished(
        step.label,
        passed=passed,
        seconds=outcome.seconds,
        detail=detail,
        warnings=outcome.warnings if passed else 0,
    )
    if not passed:
        console.failure(step, outcome)
    return passed


def _auto_fix(
    console: Console,
    environ: Mapping[str, str],
    python: Path | None,
    npm: str | None,
) -> list[str]:
    """Returns the git status lines the fixers changed. Anything still broken fails its check."""
    before = _git_status_lines()
    console.running(AUTO_FIX_LABEL)
    started = time.monotonic()
    for command, cwd in _fix_commands(python, npm):
        subprocess.run(
            command,
            cwd=cwd,
            env=dict(environ),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    changed = _changed_status(before, _git_status_lines())
    detail = f"{_plural(len(changed), 'file')} changed" if changed else "nothing to fix"
    console.finished(AUTO_FIX_LABEL, passed=True, seconds=time.monotonic() - started, detail=detail)
    return changed


def _failed(console: Console) -> int:
    console.message("Checks failed. Fix the issues above before committing.", BOLD, RED)
    return 1


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
    parser.add_argument(
        "--no-coverage",
        action="store_true",
        help="Skip measuring test coverage, which makes the tests run slower.",
    )
    args = parser.parse_args()

    # Backend venv is always needed: frontend API types are generated and not checked in.
    # ``backend_python`` gates backend steps; holding the interpreter is not the same thing.
    python = _resolve_python()
    backend_python = python if args.scope != "frontend" else None
    npm = _resolve_npm() if args.scope != "backend" else None

    generate = Step("Generate API types", [str(python), str(SCRIPTS / "generate_types.py")])
    checks = _check_steps(
        backend_python,
        npm,
        interpreter=python,
        scope=args.scope,
        lint_only=args.lint_only,
    )
    labels = [generate.label, *(step.label for step in checks)]
    if args.fix:
        labels.append(AUTO_FIX_LABEL)

    console = Console.detect(sys.stdout, os.environ, label_width=max(map(len, labels)))
    if console.color:
        _enable_windows_ansi()
    measure_coverage = not (args.lint_only or args.no_coverage)

    started = time.monotonic()
    auto_fixed: list[str] = []
    with tempfile.TemporaryDirectory(
        prefix="dataforge-coverage-", ignore_cleanup_errors=True
    ) as raw:
        coverage_dir = Path(raw)
        environ = _child_environment(
            os.environ,
            color=console.color,
            progress=console.live,
            coverage_dir=coverage_dir if measure_coverage else None,
        )
        try:
            if not _execute(console, generate, environ):
                return _failed(console)
            if args.fix:
                auto_fixed = _auto_fix(console, environ, backend_python, npm)
            for step in checks:
                if not _execute(console, step, environ):
                    return _failed(console)
        except KeyboardInterrupt:
            console.message("Interrupted.", RED)
            return 130

        if auto_fixed:
            console.message(
                "Auto-fixed formatting/lint issues. Stage the updated files and commit again.",
                BOLD,
            )
            for line in auto_fixed:
                console.line(f"  {line[3:]}", DIM)
            return 1

        if measure_coverage:
            console.coverage(
                _collect_coverage(
                    coverage_dir, backend=backend_python is not None, frontend=npm is not None
                )
            )

    scope_label = "" if args.scope == "all" else f" ({args.scope})"
    elapsed = _format_duration(time.monotonic() - started)
    console.message(f"All checks passed{scope_label} in {elapsed}.", BOLD, GREEN)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
