"""Unit tests for the shared vision plumbing, focused on cancelling a stuck model call."""

from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.vision import (
    API_ERROR,
    CANCEL_POLL_SECONDS,
    CANCELLED,
    SUCCESS,
    ModelOutcome,
    call_with_retries,
    close_vision_client,
)
from testing_fixtures import (
    TempMediaFolder,
    write_media,
    write_sysprompt,
    write_txt_caption,
)

# Long enough that a test hitting it means cancellation did not drop the request.
WEDGED_SERVER_SECONDS = 30.0
# Cancellation polls every 100ms, so a working drop lands far inside this.
CANCEL_DEADLINE_SECONDS = 5.0


class HangingCompletions:
    """Stands in for a model server that accepted the request and never answers."""

    def __init__(self, request_started: threading.Event, release: threading.Event) -> None:
        self._request_started = request_started
        self._release = release

    def create(self, **_kwargs: object) -> object:
        self._request_started.set()
        self._release.wait(timeout=WEDGED_SERVER_SECONDS)
        message = type("Message", (), {"content": "late response", "reasoning_content": None})()
        choice = type("Choice", (), {"message": message})()
        return type("Response", (), {"choices": [choice]})()


class HangingClient:
    def __init__(self, request_started: threading.Event, release: threading.Event) -> None:
        self.closed = threading.Event()
        completions = HangingCompletions(request_started, release)
        self.chat = type("Chat", (), {"completions": completions})()

    def close(self) -> None:
        self.closed.set()


class CancelWhileWaitingTests(unittest.TestCase):
    def _assert_drops_in_flight_request(self, run_job, folder_setup, client_target) -> None:
        """Start a job against a wedged server, cancel it, and require a prompt exit."""
        with TempMediaFolder() as root:
            folder_setup(root)

            request_started = threading.Event()
            release_request = threading.Event()
            cancelled = threading.Event()
            client = HangingClient(request_started, release_request)
            job_finished = threading.Event()
            results: dict[str, object] = {}

            def run() -> None:
                try:
                    results["value"] = run_job(root, cancelled.is_set)
                except Exception as exc:
                    results["error"] = exc
                finally:
                    job_finished.set()

            with patch(client_target, return_value=client):
                worker = threading.Thread(target=run, daemon=True)
                worker.start()

                self.assertTrue(
                    request_started.wait(timeout=CANCEL_DEADLINE_SECONDS),
                    "the job never reached the model request",
                )
                cancelled.set()
                started_waiting = time.monotonic()
                dropped = job_finished.wait(timeout=CANCEL_DEADLINE_SECONDS)
                waited = time.monotonic() - started_waiting

                release_request.set()
                worker.join(timeout=CANCEL_DEADLINE_SECONDS)

            self.assertTrue(dropped, "cancelling did not drop the in-flight model request")
            self.assertNotIn("error", results)
            self.assertLess(waited, CANCEL_DEADLINE_SECONDS)
            self.assertTrue(client.closed.is_set(), "the abandoned request was not torn down")

            stats = results["value"]["stats"]
            self.assertEqual(stats["cancelled"], 1)
            self.assertEqual(stats["success"], 0)

    def test_auto_caption_cancels_without_waiting_for_the_model(self) -> None:
        from automation.auto_caption import run_auto_caption_job

        def folder_setup(root) -> None:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

        self._assert_drops_in_flight_request(
            lambda root, should_cancel: run_auto_caption_job(root, should_cancel=should_cancel),
            folder_setup,
            "automation.auto_caption.create_openai_client",
        )

    def test_verify_captions_cancels_without_waiting_for_the_model(self) -> None:
        from automation.verify_captions import run_verify_captions_job

        def folder_setup(root) -> None:
            write_txt_caption(write_media(root, "photo.png"), "A caption to verify.")

        self._assert_drops_in_flight_request(
            lambda root, should_cancel: run_verify_captions_job(root, should_cancel=should_cancel),
            folder_setup,
            "automation.verify_captions.create_openai_client",
        )

    def test_abandoned_caption_leaves_the_draft_sidecar_untouched(self) -> None:
        from automation.auto_caption import run_auto_caption_job

        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            caption_path = write_txt_caption(media, "Draft.")

            request_started = threading.Event()
            release_request = threading.Event()
            cancelled = threading.Event()
            client = HangingClient(request_started, release_request)
            job_finished = threading.Event()

            def run() -> None:
                try:
                    run_auto_caption_job(root, should_cancel=cancelled.is_set)
                finally:
                    job_finished.set()

            with patch("automation.auto_caption.create_openai_client", return_value=client):
                worker = threading.Thread(target=run, daemon=True)
                worker.start()
                self.assertTrue(request_started.wait(timeout=CANCEL_DEADLINE_SECONDS))
                cancelled.set()
                self.assertTrue(job_finished.wait(timeout=CANCEL_DEADLINE_SECONDS))

                # Let the abandoned request finish; its late caption must go nowhere.
                release_request.set()
                worker.join(timeout=CANCEL_DEADLINE_SECONDS)
                time.sleep(0.2)

            self.assertEqual(caption_path.read_text(encoding="utf-8"), "Draft.")


class CallWithRetriesTests(unittest.TestCase):
    def test_runs_inline_without_a_cancel_check(self) -> None:
        outcome = call_with_retries(
            lambda: ModelOutcome(status=SUCCESS, value="caption"),
            job_label="Auto-caption",
            media_name="photo.png",
        )

        self.assertEqual(outcome.status, SUCCESS)
        self.assertEqual(outcome.value, "caption")

    def test_retries_until_success_while_cancellable(self) -> None:
        statuses = [API_ERROR, API_ERROR, SUCCESS]

        def attempt() -> ModelOutcome[str]:
            return ModelOutcome(status=statuses.pop(0), value="caption")

        outcome = call_with_retries(
            attempt,
            job_label="Auto-caption",
            media_name="photo.png",
            should_cancel=lambda: False,
        )

        self.assertEqual(outcome.status, SUCCESS)
        self.assertEqual(statuses, [])

    def test_a_slow_model_is_not_cut_off_by_the_cancel_polling(self) -> None:
        """Waiting in 100ms slices must not truncate a model that is simply thinking."""
        slow_call = CANCEL_POLL_SECONDS * 5

        def attempt() -> ModelOutcome[str]:
            time.sleep(slow_call)
            return ModelOutcome(status=SUCCESS, value="a complete caption")

        started = time.monotonic()
        outcome = call_with_retries(
            attempt,
            job_label="Auto-caption",
            media_name="photo.png",
            should_cancel=lambda: False,
        )
        waited = time.monotonic() - started

        self.assertEqual(outcome.status, SUCCESS)
        self.assertEqual(outcome.value, "a complete caption")
        self.assertGreaterEqual(waited, slow_call)

    def test_returns_the_last_failure_when_attempts_run_out(self) -> None:
        outcome = call_with_retries(
            lambda: ModelOutcome(status=API_ERROR, message="server said no"),
            job_label="Verify captions",
            media_name="photo.png",
            should_cancel=lambda: False,
        )

        self.assertEqual(outcome.status, API_ERROR)
        self.assertEqual(outcome.message, "server said no")

    def test_does_not_start_an_attempt_when_already_cancelled(self) -> None:
        calls = []

        def attempt() -> ModelOutcome[str]:
            calls.append(1)
            return ModelOutcome(status=SUCCESS, value="caption")

        outcome = call_with_retries(
            attempt,
            job_label="Auto-caption",
            media_name="photo.png",
            should_cancel=lambda: True,
        )

        self.assertEqual(outcome.status, CANCELLED)
        self.assertEqual(calls, [])

    def test_abandons_a_hanging_attempt_and_reports_cancelled(self) -> None:
        release = threading.Event()
        abandoned = []

        def attempt() -> ModelOutcome[str]:
            release.wait(timeout=WEDGED_SERVER_SECONDS)
            return ModelOutcome(status=SUCCESS, value="late caption")

        started = time.monotonic()
        outcome = call_with_retries(
            attempt,
            job_label="Auto-caption",
            media_name="photo.png",
            should_cancel=lambda: True,
            on_abandon=lambda: abandoned.append(1),
        )
        waited = time.monotonic() - started
        release.set()

        self.assertEqual(outcome.status, CANCELLED)
        self.assertEqual(abandoned, [])
        self.assertLess(waited, CANCEL_DEADLINE_SECONDS)

    def test_abandon_hook_runs_when_cancellation_lands_mid_request(self) -> None:
        release = threading.Event()
        request_started = threading.Event()
        cancelled = threading.Event()
        abandoned = []

        def attempt() -> ModelOutcome[str]:
            request_started.set()
            release.wait(timeout=WEDGED_SERVER_SECONDS)
            return ModelOutcome(status=SUCCESS, value="late caption")

        def should_cancel() -> bool:
            return cancelled.is_set()

        def cancel_once_running() -> None:
            request_started.wait(timeout=CANCEL_DEADLINE_SECONDS)
            cancelled.set()

        threading.Thread(target=cancel_once_running, daemon=True).start()

        started = time.monotonic()
        outcome = call_with_retries(
            attempt,
            job_label="Auto-caption",
            media_name="photo.png",
            should_cancel=should_cancel,
            on_abandon=lambda: abandoned.append(1),
        )
        waited = time.monotonic() - started
        release.set()

        self.assertEqual(outcome.status, CANCELLED)
        self.assertEqual(abandoned, [1])
        self.assertLess(waited, CANCEL_DEADLINE_SECONDS)

    def test_propagates_an_unexpected_error_from_the_attempt(self) -> None:
        def attempt() -> ModelOutcome[str]:
            raise RuntimeError("unexpected parse failure")

        with self.assertRaises(RuntimeError):
            call_with_retries(
                attempt,
                job_label="Verify captions",
                media_name="photo.png",
                should_cancel=lambda: False,
            )


class CloseVisionClientTests(unittest.TestCase):
    def test_closes_a_client_that_supports_it(self) -> None:
        closed = []
        client = type("Client", (), {"close": lambda _self: closed.append(1)})()

        close_vision_client(client)

        self.assertEqual(closed, [1])

    def test_ignores_a_client_without_close(self) -> None:
        close_vision_client(object())

    def test_swallows_a_failing_close(self) -> None:
        def boom(_self: object) -> None:
            raise OSError("socket already gone")

        close_vision_client(type("Client", (), {"close": boom})())


if __name__ == "__main__":
    unittest.main()
