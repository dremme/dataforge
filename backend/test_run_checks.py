from __future__ import annotations

import functools
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import warnings
from pathlib import Path
from types import ModuleType
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
RUN_CHECKS_PATH = SCRIPTS / "run_checks.py"
NPM = str(Path("nodejs") / "npm.CMD")

VITEST_SUMMARY = (
    "\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m233 passed\x1b[39m\x1b[22m\x1b[90m (233)\x1b[39m\n"
    "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m2646 passed\x1b[39m\x1b[22m\x1b[90m (2646)\x1b[39m\n"
    "\x1b[2m   Start at \x1b[22m 01:10:52\n"
)


@functools.cache
def _load_run_checks() -> ModuleType:
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec = importlib.util.spec_from_file_location("dataforge_run_checks", RUN_CHECKS_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot load {RUN_CHECKS_PATH}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(SCRIPTS))


class TerminalStream(io.TextIOWrapper):
    def __init__(self, *, tty: bool, encoding: str = "utf-8") -> None:
        super().__init__(io.BytesIO(), encoding=encoding)
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty


class RunChecksTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.run_checks = _load_run_checks()

    def _console(self, stream: io.StringIO, *, color: bool = False, live: bool = False):
        return self.run_checks.Console(
            stream,
            color=color,
            live=live,
            glyphs=self.run_checks.PLAIN_GLYPHS,
            label_width=12,
        )


class DurationTests(RunChecksTestCase):
    def test_under_a_minute_shows_tenths_of_a_second(self) -> None:
        self.assertEqual(self.run_checks._format_duration(0.04), "0.0s")
        self.assertEqual(self.run_checks._format_duration(41.26), "41.3s")

    def test_a_minute_or_more_shows_minutes_and_padded_seconds(self) -> None:
        self.assertEqual(self.run_checks._format_duration(61), "1m 01s")
        self.assertEqual(self.run_checks._format_duration(59.96), "1m 00s")
        self.assertEqual(self.run_checks._format_duration(98.4), "1m 38s")


class CommandDisplayTests(RunChecksTestCase):
    def test_the_interpreter_and_project_paths_are_shortened(self) -> None:
        step = self.run_checks.Step(
            "Backend lint",
            [
                str(ROOT / "backend" / ".venv" / "Scripts" / "python.exe"),
                str(SCRIPTS / "run_lint.py"),
            ],
        )
        self.assertEqual(step.shown_command, "python scripts/run_lint.py")
        self.assertEqual(step.shown_location, "")

    def test_a_frontend_step_names_its_folder(self) -> None:
        step = self.run_checks.Step("Frontend ESLint", [NPM, "run", "lint"], ROOT / "frontend")
        self.assertEqual(step.shown_command, "npm run lint")
        self.assertEqual(step.shown_location, "frontend/")


class ChildEnvironmentTests(RunChecksTestCase):
    def test_color_on_forces_color_and_drops_no_color(self) -> None:
        environ = self.run_checks._child_environment(
            {"NO_COLOR": "1", "KEEP": "x"}, color=True, progress=False
        )
        self.assertEqual(environ["FORCE_COLOR"], "1")
        self.assertNotIn("NO_COLOR", environ)
        self.assertEqual(environ["KEEP"], "x")

    def test_color_off_drops_an_inherited_force_color(self) -> None:
        environ = self.run_checks._child_environment(
            {"FORCE_COLOR": "1"}, color=False, progress=False
        )
        self.assertEqual(environ["NO_COLOR"], "1")
        self.assertNotIn("FORCE_COLOR", environ)

    def test_progress_is_requested_only_when_asked_for(self) -> None:
        wanted = self.run_checks._child_environment({}, color=False, progress=True)
        self.assertEqual(wanted[self.run_checks.PROGRESS_ENV], "1")

    def test_an_inherited_progress_request_is_dropped(self) -> None:
        base = {self.run_checks.PROGRESS_ENV: "1"}
        environ = self.run_checks._child_environment(base, color=False, progress=False)
        self.assertNotIn(self.run_checks.PROGRESS_ENV, environ)

    def test_children_are_quiet_and_write_utf8(self) -> None:
        environ = self.run_checks._child_environment({}, color=False, progress=False)
        self.assertEqual(environ["NPM_CONFIG_LOGLEVEL"], "silent")
        self.assertEqual(environ["PYTHONIOENCODING"], "utf-8")


class DetectTests(RunChecksTestCase):
    def _detect(self, stream: TerminalStream, environ: dict[str, str]):
        return self.run_checks.Console.detect(stream, environ, label_width=10)

    def test_a_terminal_gets_color_and_a_live_line(self) -> None:
        console = self._detect(TerminalStream(tty=True), {"TERM": "xterm"})
        self.assertTrue(console.color)
        self.assertTrue(console.live)

    def test_a_pipe_gets_neither(self) -> None:
        console = self._detect(TerminalStream(tty=False), {})
        self.assertFalse(console.color)
        self.assertFalse(console.live)

    def test_no_color_beats_a_terminal(self) -> None:
        console = self._detect(TerminalStream(tty=True), {"NO_COLOR": "1"})
        self.assertFalse(console.color)

    def test_force_color_colors_a_pipe_but_never_repaints_it(self) -> None:
        console = self._detect(TerminalStream(tty=False), {"FORCE_COLOR": "1"})
        self.assertTrue(console.color)
        self.assertFalse(console.live)

    def test_a_dumb_terminal_is_not_live(self) -> None:
        console = self._detect(TerminalStream(tty=True), {"TERM": "dumb"})
        self.assertFalse(console.live)

    def test_a_unicode_stream_gets_the_fancy_glyphs(self) -> None:
        console = self._detect(TerminalStream(tty=False), {})
        self.assertEqual(console._glyphs, self.run_checks.FANCY_GLYPHS)

    def test_a_codepage_stream_falls_back_to_plain_glyphs(self) -> None:
        console = self._detect(TerminalStream(tty=False, encoding="cp1252"), {})
        self.assertEqual(console._glyphs, self.run_checks.PLAIN_GLYPHS)


class ConsoleTests(RunChecksTestCase):
    def test_a_passing_step_is_one_aligned_line(self) -> None:
        stream = io.StringIO()
        console = self._console(stream)
        console.finished("Lint", passed=True, seconds=1.25, detail="3 tests")
        self.assertEqual(stream.getvalue(), "  + Lint            1.2s  3 tests\n")

    def test_warnings_follow_the_detail(self) -> None:
        stream = io.StringIO()
        console = self._console(stream)
        console.finished("Lint", passed=True, seconds=1.25, detail="3 tests", warnings=1)
        self.assertEqual(stream.getvalue(), "  + Lint            1.2s  3 tests, 1 warning\n")

    def test_warnings_stand_alone_without_a_detail(self) -> None:
        stream = io.StringIO()
        self._console(stream).finished("Lint", passed=True, seconds=0.5, warnings=2)
        self.assertEqual(stream.getvalue(), "  + Lint            0.5s  2 warnings\n")

    def test_warnings_are_yellow(self) -> None:
        stream = io.StringIO()
        self._console(stream, color=True).finished("Lint", passed=True, seconds=0.1, warnings=1)
        self.assertIn("\x1b[33m1 warning\x1b[0m", stream.getvalue())

    def test_a_failing_step_is_marked_and_carries_no_detail(self) -> None:
        stream = io.StringIO()
        self._console(stream).finished("Lint", passed=False, seconds=0.5)
        self.assertEqual(stream.getvalue(), "  x Lint            0.5s\n")

    def test_a_piped_console_never_announces_a_running_step(self) -> None:
        stream = io.StringIO()
        self._console(stream).running("Lint")
        self.assertEqual(stream.getvalue(), "")

    def test_a_live_console_replaces_the_running_line_with_the_result(self) -> None:
        stream = io.StringIO()
        console = self._console(stream, live=True)
        console.running("Lint")
        console.finished("Lint", passed=True, seconds=0.1)
        running_line = "  > Lint..."
        self.assertEqual(
            stream.getvalue(),
            f"\r{running_line}\r{' ' * len(running_line)}\r  + Lint            0.1s\n",
        )

    def test_a_live_console_draws_a_bar_over_the_running_line(self) -> None:
        stream = io.StringIO()
        console = self._console(stream, live=True)
        console.running("Lint")
        console.progress("Lint", 0.5)
        bar = "#" * 10 + "-" * 10
        self.assertEqual(stream.getvalue().split("\r")[-1], f"  > Lint          {bar}   50%")

    def test_a_finished_step_leaves_no_bar_behind(self) -> None:
        stream = io.StringIO()
        console = self._console(stream, live=True)
        console.running("Lint")
        console.progress("Lint", 1.0)
        console.finished("Lint", passed=True, seconds=0.1)
        shown = stream.getvalue()
        bar_line = "  > Lint          " + "#" * 20 + "  100%"
        self.assertIn(f"\r{' ' * len(bar_line)}\r  + Lint            0.1s\n", shown)
        self.assertTrue(shown.endswith("  + Lint            0.1s\n"))

    def test_a_shorter_redraw_pads_over_the_longer_one(self) -> None:
        stream = io.StringIO()
        console = self._console(stream, live=True)
        console.progress("Lint", 0.5)
        drawn = stream.getvalue()
        bar_width = len(drawn) - len("\r")
        console.running("Lint")
        running_line = "  > Lint..."
        expected = "\r" + running_line + " " * (bar_width - len(running_line))
        self.assertEqual(stream.getvalue()[len(drawn) :], expected)

    def test_a_piped_console_ignores_progress(self) -> None:
        stream = io.StringIO()
        self._console(stream).progress("Lint", 0.5)
        self.assertEqual(stream.getvalue(), "")

    def test_an_unchanged_percentage_is_not_redrawn(self) -> None:
        stream = io.StringIO()
        console = self._console(stream, live=True)
        console.progress("Lint", 0.501)
        drawn = stream.getvalue()
        console.progress("Lint", 0.509)
        self.assertEqual(stream.getvalue(), drawn)

    def test_progress_is_clamped_to_the_bar(self) -> None:
        stream = io.StringIO()
        console = self._console(stream, live=True)
        console.progress("Lint", 1.7)
        self.assertIn("#" * 20 + "  100%", stream.getvalue())
        console.running("Lint")
        console.progress("Lint", -0.2)
        self.assertIn("-" * 20 + "    0%", stream.getvalue())

    def test_the_filled_part_of_the_bar_is_green(self) -> None:
        stream = io.StringIO()
        self._console(stream, color=True, live=True).progress("Lint", 0.25)
        self.assertIn("\x1b[32m" + "#" * 5 + "\x1b[0m", stream.getvalue())

    def test_color_wraps_the_glyph_and_dims_the_timing(self) -> None:
        stream = io.StringIO()
        self._console(stream, color=True).finished("Lint", passed=True, seconds=0.1)
        self.assertIn("\x1b[32m+\x1b[0m", stream.getvalue())
        self.assertIn("\x1b[2m  0.1s\x1b[0m", stream.getvalue())

    def test_a_failure_shows_the_command_the_exit_code_and_the_output(self) -> None:
        stream = io.StringIO()
        step = self.run_checks.Step("Frontend ESLint", [NPM, "run", "lint"], ROOT / "frontend")
        outcome = self.run_checks.Outcome(returncode=2, output="\nsrc/a.ts:1 broken\n\n", seconds=1)
        self._console(stream).failure(step, outcome)
        self.assertEqual(
            stream.getvalue(),
            "\n  $ npm run lint  (frontend/, exit 2)\n\nsrc/a.ts:1 broken\n",
        )

    def test_a_failure_without_output_still_names_the_exit_code(self) -> None:
        stream = io.StringIO()
        step = self.run_checks.Step("Lint", ["python", "lint.py"])
        outcome = self.run_checks.Outcome(returncode=1, output="", seconds=1)
        self._console(stream).failure(step, outcome)
        self.assertEqual(stream.getvalue(), "\n  $ python lint.py  (exit 1)\n\n")

    def test_failure_output_the_console_cannot_encode_is_replaced(self) -> None:
        stream = TerminalStream(tty=False, encoding="cp1252")
        step = self.run_checks.Step("Lint", ["python", "lint.py"])
        outcome = self.run_checks.Outcome(returncode=1, output="error\n└── a.py:1", seconds=1)
        self._console(stream).failure(step, outcome)
        shown = stream.buffer.getvalue().decode("cp1252").replace(os.linesep, "\n")
        self.assertEqual(shown, "\n  $ python lint.py  (exit 1)\n\nerror\n??? a.py:1\n")


class DetailTests(RunChecksTestCase):
    def _detail(self, pattern, output: str) -> str:
        step = self.run_checks.Step("Tests", ["python"], test_count=pattern)
        return self.run_checks._detail(step, output)

    def test_unittest_reports_its_count(self) -> None:
        output = "-----\nRan 2071 tests in 54.894s\n\nOK\n"
        self.assertEqual(self._detail(self.run_checks.BACKEND_TEST_COUNT, output), "2071 tests")

    def test_a_single_test_is_singular(self) -> None:
        output = "Ran 1 test in 0.001s\n\nOK\n"
        self.assertEqual(self._detail(self.run_checks.BACKEND_TEST_COUNT, output), "1 test")

    def test_vitest_reports_the_total_through_its_color_codes(self) -> None:
        self.assertEqual(
            self._detail(self.run_checks.FRONTEND_TEST_COUNT, VITEST_SUMMARY), "2646 tests"
        )

    def test_vitest_does_not_mistake_the_file_count_for_the_test_count(self) -> None:
        output = " Test Files  3 passed (3)\n      Tests  10 passed | 2 skipped (12)\n"
        self.assertEqual(self._detail(self.run_checks.FRONTEND_TEST_COUNT, output), "12 tests")

    def test_an_unrecognised_summary_shows_nothing(self) -> None:
        self.assertEqual(self._detail(self.run_checks.FRONTEND_TEST_COUNT, "all good\n"), "")

    def test_a_step_without_a_counter_shows_nothing(self) -> None:
        step = self.run_checks.Step("Lint", ["python"])
        self.assertEqual(self.run_checks._detail(step, "Ran 5 tests in 1s"), "")


class ExecuteTests(RunChecksTestCase):
    def _step(self, code: str):
        return self.run_checks.Step("Sample", [sys.executable, "-c", code])

    def _run(self, code: str) -> tuple[bool, str]:
        stream = io.StringIO()
        environ = self.run_checks._child_environment({}, color=False, progress=False)
        passed = self.run_checks._execute(self._console(stream), self._step(code), environ)
        return passed, stream.getvalue()

    def test_a_passing_step_hides_everything_it_printed(self) -> None:
        passed, shown = self._run("print('chatter'); import sys; print('noise', file=sys.stderr)")
        self.assertTrue(passed)
        self.assertNotIn("chatter", shown)
        self.assertNotIn("noise", shown)
        self.assertEqual(len(shown.splitlines()), 1)

    def test_a_failing_step_shows_both_streams_in_order(self) -> None:
        passed, shown = self._run(
            "import sys; print('first'); sys.stdout.flush(); print('second', file=sys.stderr); sys.exit(3)"
        )
        self.assertFalse(passed)
        self.assertIn("exit 3", shown)
        self.assertLess(shown.index("first"), shown.index("second"))

    def test_a_passing_step_counts_its_warnings_without_showing_them(self) -> None:
        passed, shown = self._run("print('DeprecationWarning: old'); print('@warnings 2')")
        self.assertTrue(passed)
        self.assertNotIn("old", shown)
        self.assertIn("2 warnings", shown)

    def test_a_failing_step_shows_no_warning_count(self) -> None:
        passed, shown = self._run("print('@warnings 2'); raise SystemExit(1)")
        self.assertFalse(passed)
        self.assertNotIn("2 warnings", shown.splitlines()[0])

    def test_non_ascii_output_is_decoded_as_utf8(self) -> None:
        passed, shown = self._run("print('caf\\u00e9 \\u2713'); raise SystemExit(1)")
        self.assertFalse(passed)
        self.assertIn("caf\u00e9 \u2713", shown)


class CaptureTests(RunChecksTestCase):
    def _capture(self, code: str, fractions: list[float] | None = None):
        step = self.run_checks.Step("Sample", [sys.executable, "-c", code])
        environ = self.run_checks._child_environment({}, color=False, progress=False)
        callback = fractions.append if fractions is not None else None
        return self.run_checks._capture(step, environ, callback)

    def test_progress_markers_report_a_fraction_and_leave_the_output(self) -> None:
        fractions: list[float] = []
        outcome = self._capture(
            "print('@progress 1/4'); print('kept'); print('@progress 3/4')", fractions
        )
        self.assertEqual(fractions, [0.25, 0.75])
        self.assertEqual(outcome.output, "kept\n")

    def test_a_marker_after_unterminated_output_restores_that_output(self) -> None:
        code = "print('ab', end=''); print('@progress 1/2'); print('cd')"
        self.assertEqual(self._capture(code).output, "abcd\n")

    def test_an_empty_total_is_not_divided_by(self) -> None:
        fractions: list[float] = []
        self._capture("print('@progress 0/0')", fractions)
        self.assertEqual(fractions, [])

    def test_progress_arrives_while_the_child_is_still_running(self) -> None:
        code = (
            "import sys, time; print('@progress 1/2'); sys.stdout.flush(); "
            "time.sleep(0.6); print('@progress 2/2')"
        )
        step = self.run_checks.Step("Sample", [sys.executable, "-c", code])
        environ = self.run_checks._child_environment({}, color=False, progress=False)
        first_report: list[float] = []
        self.run_checks._capture(
            step,
            environ,
            lambda _: first_report.append(time.monotonic()) if not first_report else None,
        )
        self.assertGreater(time.monotonic() - first_report[0], 0.3)

    def test_a_warnings_marker_is_counted_and_left_out_of_the_output(self) -> None:
        outcome = self._capture("print('kept'); print('@warnings 3')")
        self.assertEqual(outcome.warnings, 3)
        self.assertEqual(outcome.output, "kept\n")

    def test_a_step_without_a_warnings_marker_has_none(self) -> None:
        self.assertEqual(self._capture("print('kept')").warnings, 0)

    def test_the_exit_code_survives_streaming(self) -> None:
        self.assertEqual(self._capture("raise SystemExit(7)").returncode, 7)


class ProgressProtocolTests(RunChecksTestCase):
    def _load_run_tests(self) -> ModuleType:
        spec = importlib.util.spec_from_file_location(
            "dataforge_run_tests", SCRIPTS / "run_tests.py"
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load run_tests.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_the_backend_runner_speaks_the_marker_the_console_reads(self) -> None:
        run_tests = self._load_run_tests()
        self.assertEqual(run_tests.PROGRESS_ENV, self.run_checks.PROGRESS_ENV)
        marker = self.run_checks.PROGRESS_MARKER.fullmatch(f"{run_tests.PROGRESS_PREFIX}3/10\n")
        self.assertIsNotNone(marker)

    def test_the_backend_runner_speaks_the_warnings_marker_the_console_reads(self) -> None:
        marker = self.run_checks.WARNINGS_MARKER.fullmatch(
            f"{self._load_run_tests().WARNINGS_PREFIX}2\n"
        )
        self.assertIsNotNone(marker)

    def test_the_frontend_reporter_speaks_the_same_marker(self) -> None:
        run_tests = self._load_run_tests()
        source = (ROOT / "frontend" / "vitest.progress.ts").read_text(encoding="utf-8")
        self.assertIn(f'PROGRESS_PREFIX = "{run_tests.PROGRESS_PREFIX}"', source)
        self.assertIn(f'WARNINGS_PREFIX = "{run_tests.WARNINGS_PREFIX}"', source)
        self.assertIn(f"process.env.{self.run_checks.PROGRESS_ENV}", source)

    def test_the_backend_runner_counts_shown_warnings_but_not_expected_ones(self) -> None:
        run_tests = self._load_run_tests()

        class Sample(unittest.TestCase):
            def test_unexpected(self) -> None:
                warnings.warn("unexpected", DeprecationWarning, stacklevel=1)

            def test_expected(self) -> None:
                with self.assertWarns(UserWarning):
                    warnings.warn("expected", UserWarning, stacklevel=1)

        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Sample)
        runner = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0, buffer=True)
        # Keeps the sample's warning away from the counter of the run executing this test.
        with warnings.catch_warnings(), mock.patch.object(warnings, "showwarning"):
            warnings.simplefilter("default")
            counter = run_tests.WarningCounter()
            warnings.showwarning = counter.show
            result = runner.run(suite)
        self.assertTrue(result.wasSuccessful())
        self.assertEqual(counter.count, 1)

    def test_the_frontend_step_loads_the_reporter_it_names(self) -> None:
        steps = self.run_checks._check_steps(None, "npm", interpreter=Path("python"), scope="all")
        frontend_tests = next(step for step in steps if step.label == "Frontend tests")
        reporter = next(arg for arg in frontend_tests.command if arg.startswith("--reporter=./"))
        self.assertTrue((ROOT / "frontend" / reporter.removeprefix("--reporter=./")).is_file())

    def test_the_backend_result_reports_each_finished_test_against_the_total(self) -> None:
        run_tests = self._load_run_tests()

        class Sample(unittest.TestCase):
            def test_one(self) -> None:
                pass

            def test_two(self) -> None:
                self.fail("broken")

        stream = io.StringIO()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Sample)
        runner = unittest.TextTestRunner(
            stream=stream, verbosity=0, buffer=True, resultclass=run_tests.progress_result(2)
        )
        runner.run(suite)
        self.assertEqual(stream.getvalue().count("@progress 1/2\n@progress 2/2\n"), 1)

    def test_two_runs_do_not_share_a_count(self) -> None:
        run_tests = self._load_run_tests()

        class Sample(unittest.TestCase):
            def test_one(self) -> None:
                pass

        outputs = []
        for _ in range(2):
            stream = io.StringIO()
            suite = unittest.defaultTestLoader.loadTestsFromTestCase(Sample)
            unittest.TextTestRunner(
                stream=stream, verbosity=0, resultclass=run_tests.progress_result(1)
            ).run(suite)
            outputs.append(stream.getvalue())
        self.assertIn("@progress 1/1\n", outputs[0])
        self.assertIn("@progress 1/1\n", outputs[1])


class CoverageTotalsTests(RunChecksTestCase):
    def test_the_percentage_is_covered_over_total(self) -> None:
        totals = self.run_checks.CoverageTotals(covered=1, total=8)
        self.assertEqual(totals.percent, 12.5)

    def test_a_tree_without_statements_counts_as_fully_covered(self) -> None:
        self.assertEqual(self.run_checks.CoverageTotals(covered=0, total=0).percent, 100.0)


class CoverageConsoleTests(RunChecksTestCase):
    def _totals(self, covered: int, total: int):
        return self.run_checks.CoverageTotals(covered=covered, total=total)

    def test_each_side_gets_one_aligned_line_under_one_title(self) -> None:
        stream = io.StringIO()
        self._console(stream).coverage(
            {"backend": self._totals(9_058, 10_000), "frontend": self._totals(27_474, 29_188)}
        )
        self.assertEqual(
            stream.getvalue(),
            "\n"
            "  Coverage  backend    90.6%  9,058 of 10,000 lines\n"
            "            frontend   94.1%  27,474 of 29,188 lines\n",
        )

    def test_a_single_side_is_a_single_line(self) -> None:
        stream = io.StringIO()
        self._console(stream).coverage({"frontend": self._totals(1, 2)})
        self.assertEqual(len(stream.getvalue().strip("\n").splitlines()), 1)

    def test_a_side_without_a_report_says_so(self) -> None:
        stream = io.StringIO()
        self._console(stream).coverage({"backend": None})
        self.assertEqual(stream.getvalue(), "\n  Coverage  backend  no data\n")

    def test_the_percentage_is_bold_and_the_counts_are_dim(self) -> None:
        stream = io.StringIO()
        self._console(stream, color=True).coverage({"backend": self._totals(1, 2)})
        self.assertIn("\x1b[1m 50.0%\x1b[0m", stream.getvalue())
        self.assertIn("\x1b[2m1 of 2 lines\x1b[0m", stream.getvalue())


class CoverageReportTests(RunChecksTestCase):
    def _write(self, directory: Path, name: str, payload: object) -> None:
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def test_a_backend_report_yields_its_statement_totals(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            self._write(
                directory,
                self.run_checks.BACKEND_COVERAGE_FILE,
                {"totals": {"covered_lines": 90, "num_statements": 100}},
            )
            results = self.run_checks._collect_coverage(directory, backend=True, frontend=False)
        self.assertEqual(results, {"backend": self.run_checks.CoverageTotals(90, 100)})

    def test_a_frontend_report_yields_its_line_totals(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            self._write(
                directory,
                self.run_checks.FRONTEND_COVERAGE_FILE,
                {"total": {"lines": {"total": 40, "covered": 30, "pct": 75}, "branches": {}}},
            )
            results = self.run_checks._collect_coverage(directory, backend=False, frontend=True)
        self.assertEqual(results, {"frontend": self.run_checks.CoverageTotals(30, 40)})

    def test_only_the_sides_that_ran_are_reported(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            results = self.run_checks._collect_coverage(Path(raw), backend=True, frontend=True)
        self.assertEqual(list(results), ["backend", "frontend"])

    def test_a_missing_report_is_no_data_rather_than_a_crash(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            results = self.run_checks._collect_coverage(Path(raw), backend=True, frontend=False)
        self.assertEqual(results, {"backend": None})

    def test_a_malformed_or_unexpected_report_is_no_data(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            path = directory / self.run_checks.BACKEND_COVERAGE_FILE
            for content in ("not json", "[]", '{"totals": {}}'):
                path.write_text(content, encoding="utf-8")
                results = self.run_checks._collect_coverage(directory, backend=True, frontend=False)
                self.assertEqual(results, {"backend": None}, content)

    def test_children_are_told_where_to_write_only_when_measuring(self) -> None:
        directory = Path("scratch")
        measuring = self.run_checks._child_environment(
            {}, color=False, progress=False, coverage_dir=directory
        )
        self.assertEqual(measuring[self.run_checks.COVERAGE_ENV], str(directory))
        inherited = {self.run_checks.COVERAGE_ENV: "elsewhere"}
        skipping = self.run_checks._child_environment(inherited, color=False, progress=False)
        self.assertNotIn(self.run_checks.COVERAGE_ENV, skipping)


class CoverageProtocolTests(RunChecksTestCase):
    def _run_tests_module(self) -> ModuleType:
        spec = importlib.util.spec_from_file_location(
            "dataforge_run_tests_coverage", SCRIPTS / "run_tests.py"
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load run_tests.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_the_backend_runner_writes_where_the_console_reads(self) -> None:
        run_tests = self._run_tests_module()
        self.assertEqual(run_tests.COVERAGE_ENV, self.run_checks.COVERAGE_ENV)
        self.assertEqual(run_tests.COVERAGE_FILE, self.run_checks.BACKEND_COVERAGE_FILE)

    def test_the_vitest_config_writes_where_the_console_reads(self) -> None:
        source = (ROOT / "frontend" / "vitest.config.ts").read_text(encoding="utf-8")
        folder, name = self.run_checks.FRONTEND_COVERAGE_FILE.split("/")
        self.assertIn(f"process.env.{self.run_checks.COVERAGE_ENV}", source)
        self.assertIn(f'path.join(coverageDir, "{folder}")', source)
        self.assertIn('reporter: ["json-summary"]', source)
        self.assertEqual(name, "coverage-summary.json")

    def test_the_backend_runner_produces_a_report_the_console_can_read(self) -> None:
        script = (
            "import os, sys; sys.path.insert(0, sys.argv[1]); import run_tests; "
            "os.chdir(sys.argv[2]); sys.path.insert(0, sys.argv[2]); "
            "collector = run_tests.start_coverage(); import constants; "
            "run_tests.write_coverage(collector)"
        )
        with tempfile.TemporaryDirectory() as raw:
            environ = {**os.environ, self.run_checks.COVERAGE_ENV: raw}
            subprocess.run(
                [sys.executable, "-c", script, str(SCRIPTS), str(ROOT / "backend")],
                env=environ,
                check=True,
                capture_output=True,
            )
            report = json.loads(
                (Path(raw) / self.run_checks.BACKEND_COVERAGE_FILE).read_text(encoding="utf-8")
            )
            totals = self.run_checks._backend_totals(report)
        self.assertGreater(totals.total, 0)
        self.assertGreater(totals.covered, 0)
        measured = [name.replace("\\", "/") for name in report["files"]]
        self.assertTrue(any(name.endswith("constants.py") for name in measured))
        self.assertFalse([name for name in measured if "/test_" in "/" + name])


class ChangedStatusTests(RunChecksTestCase):
    def test_a_file_the_fixers_touched_shows_up_as_a_new_status_line(self) -> None:
        before = [" M a.py", "?? b.py"]
        after = ["MM a.py", "?? b.py", " M c.py"]
        self.assertEqual(self.run_checks._changed_status(before, after), ["MM a.py", " M c.py"])

    def test_an_unchanged_tree_reports_nothing(self) -> None:
        self.assertEqual(self.run_checks._changed_status([" M a.py"], [" M a.py"]), [])


if __name__ == "__main__":
    unittest.main()
