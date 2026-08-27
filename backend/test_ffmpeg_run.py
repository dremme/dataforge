from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import sys
import unittest
from unittest.mock import patch

from ffmpeg_run import FfmpegCancelled, parse_progress_seconds, run_ffmpeg


def _script(body: str) -> list[str]:
    return [sys.executable, "-c", body]


SLEEP_FOREVER = _script("import time; time.sleep(30)")


class ParseProgressSecondsTests(unittest.TestCase):
    def test_reads_microseconds(self) -> None:
        self.assertEqual(parse_progress_seconds("out_time_us=1500000"), 1.5)

    def test_reads_the_misnamed_millisecond_key_as_microseconds(self) -> None:
        """ffmpeg's ``out_time_ms`` has always carried microseconds."""
        self.assertEqual(parse_progress_seconds("out_time_ms=250000\n"), 0.25)

    def test_ignores_other_keys(self) -> None:
        self.assertIsNone(parse_progress_seconds("frame=12"))
        self.assertIsNone(parse_progress_seconds("progress=end"))

    def test_ignores_a_position_ffmpeg_cannot_report_yet(self) -> None:
        self.assertIsNone(parse_progress_seconds("out_time_us=N/A"))

    def test_ignores_a_line_that_is_not_a_pair(self) -> None:
        self.assertIsNone(parse_progress_seconds("out_time_us"))

    def test_floors_a_negative_position_at_zero(self) -> None:
        self.assertEqual(parse_progress_seconds("out_time_us=-40000"), 0.0)


class RunFfmpegTests(unittest.TestCase):
    def test_returns_on_a_clean_exit(self) -> None:
        run_ffmpeg(_script("pass"))

    def test_raises_with_the_stderr_on_a_failing_exit(self) -> None:
        command = _script("import sys; sys.stderr.write('Invalid argument'); sys.exit(1)")

        with self.assertRaises(RuntimeError) as caught:
            run_ffmpeg(command)

        self.assertIn("Invalid argument", str(caught.exception))

    def test_reports_a_bare_failure_when_stderr_is_empty(self) -> None:
        with self.assertRaises(RuntimeError) as caught:
            run_ffmpeg(_script("import sys; sys.exit(3)"))

        self.assertEqual(str(caught.exception), "ffmpeg failed")

    def test_drains_a_stderr_larger_than_the_pipe_buffer(self) -> None:
        """A chatty ffmpeg would deadlock on a full buffer if nobody read it."""
        command = _script("import sys; sys.stderr.write('x' * 200000); sys.exit(1)")

        with self.assertRaises(RuntimeError) as caught:
            run_ffmpeg(command)

        self.assertEqual(len(str(caught.exception)), 200000)

    def test_wraps_a_process_that_cannot_be_started(self) -> None:
        with self.assertRaises(RuntimeError) as caught:
            run_ffmpeg(["definitely-not-an-executable-2f8a1c"])

        self.assertIn("Failed to run ffmpeg", str(caught.exception))

    def test_terminates_the_process_when_the_caller_cancels(self) -> None:
        with self.assertRaises(FfmpegCancelled):
            run_ffmpeg(SLEEP_FOREVER, should_cancel=lambda: True)

    def test_does_not_cancel_a_process_that_finishes_first(self) -> None:
        cancelled = {"asked": False}

        def should_cancel() -> bool:
            cancelled["asked"] = True
            return True

        run_ffmpeg(_script("pass"), should_cancel=should_cancel)

        self.assertFalse(cancelled["asked"])

    def test_kills_a_process_that_outlives_its_deadline(self) -> None:
        with self.assertRaises(RuntimeError) as caught:
            run_ffmpeg(SLEEP_FOREVER, timeout=0.0)

        self.assertEqual(str(caught.exception), "ffmpeg timed out")

    def test_kills_a_process_that_ignores_terminate(self) -> None:
        with patch("ffmpeg_run.FFMPEG_TERMINATE_SECONDS", 0.05):
            with self.assertRaises(FfmpegCancelled):
                run_ffmpeg(SLEEP_FOREVER, should_cancel=lambda: True)

    def test_reports_progress_positions_from_stdout(self) -> None:
        command = _script(
            "print('frame=1'); print('out_time_us=500000'); "
            "print('out_time_us=N/A'); print('out_time_us=1000000'); print('progress=end')"
        )
        seen: list[float] = []

        run_ffmpeg(command, on_progress=seen.append)

        self.assertEqual(seen, [0.5, 1.0])

    def test_leaves_stdout_unread_without_a_progress_callback(self) -> None:
        run_ffmpeg(_script("print('out_time_us=1')"))


if __name__ == "__main__":
    unittest.main()
