"""Unit tests for automation.llm."""

from __future__ import annotations

import threading
import time
import unittest
from typing import ClassVar
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.llm import (
    API_ERROR,
    CANCEL_POLL_SECONDS,
    CANCELLED,
    SUCCESS,
    ModelOutcome,
    call_with_retries,
    close_model_client,
    describe_empty_completion,
    describe_exception,
    model_client,
    run_chat_completion,
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
        self.close_count = 0
        completions = HangingCompletions(request_started, release)
        self.chat = type("Chat", (), {"completions": completions})()

    def close(self) -> None:
        self.close_count += 1
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
            # Once to tear down the request that was still hanging, once when the run
            # scope ended. A single close means the in-flight teardown never happened,
            # which the event alone can no longer tell apart.
            self.assertEqual(client.close_count, 2)

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
            "automation.llm.create_openai_client",
        )

    def test_verify_captions_cancels_without_waiting_for_the_model(self) -> None:
        from automation.verify_captions import run_verify_captions_job

        def folder_setup(root) -> None:
            write_txt_caption(write_media(root, "photo.png"), "A caption to verify.")

        self._assert_drops_in_flight_request(
            lambda root, should_cancel: run_verify_captions_job(root, should_cancel=should_cancel),
            folder_setup,
            "automation.llm.create_openai_client",
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

            with patch("automation.llm.create_openai_client", return_value=client):
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
            lambda _number: ModelOutcome(status=SUCCESS, value="caption"),
            job_label="Auto-caption",
            media_name="photo.png",
        )

        self.assertEqual(outcome.status, SUCCESS)
        self.assertEqual(outcome.value, "caption")

    def test_retries_until_success_while_cancellable(self) -> None:
        statuses = [API_ERROR, API_ERROR, SUCCESS]

        def attempt(_number: int) -> ModelOutcome[str]:
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

        def attempt(_number: int) -> ModelOutcome[str]:
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
            lambda _number: ModelOutcome(status=API_ERROR, message="server said no"),
            job_label="Verify captions",
            media_name="photo.png",
            should_cancel=lambda: False,
        )

        self.assertEqual(outcome.status, API_ERROR)
        self.assertEqual(outcome.message, "server said no")

    def test_does_not_start_an_attempt_when_already_cancelled(self) -> None:
        calls = []

        def attempt(_number: int) -> ModelOutcome[str]:
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

        def attempt(_number: int) -> ModelOutcome[str]:
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

        def attempt(_number: int) -> ModelOutcome[str]:
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
        def attempt(_number: int) -> ModelOutcome[str]:
            raise RuntimeError("unexpected parse failure")

        with self.assertRaises(RuntimeError):
            call_with_retries(
                attempt,
                job_label="Verify captions",
                media_name="photo.png",
                should_cancel=lambda: False,
            )


class ModelClientScopeTests(unittest.TestCase):
    """A client holds a connection pool, so every run has to hand it back."""

    class _SpyClient:
        def __init__(self) -> None:
            self.close_count = 0

        def close(self) -> None:
            self.close_count += 1

    def test_closes_the_client_when_the_run_ends(self) -> None:
        client = self._SpyClient()

        with patch("automation.llm.create_openai_client", return_value=client):
            with model_client() as scoped:
                self.assertIs(scoped, client)
                self.assertEqual(client.close_count, 0)

        self.assertEqual(client.close_count, 1)

    def test_closes_the_client_when_the_run_raises(self) -> None:
        client = self._SpyClient()

        with patch("automation.llm.create_openai_client", return_value=client):
            with self.assertRaises(ValueError), model_client():
                raise ValueError("job blew up")

        self.assertEqual(client.close_count, 1)

    def test_a_completed_auto_caption_job_does_not_keep_its_client(self) -> None:
        client = self._SpyClient()

        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            from automation.auto_caption import run_auto_caption_job

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                patch("automation.auto_caption.complete_caption", return_value=None),
            ):
                run_auto_caption_job(root)

        self.assertEqual(client.close_count, 1)

    def test_a_completed_verify_captions_job_does_not_keep_its_client(self) -> None:
        client = self._SpyClient()

        with TempMediaFolder() as root:
            write_txt_caption(write_media(root, "photo.png"), "A caption to verify.")

            from automation.verify_captions import run_verify_captions_job

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                patch("automation.verify_captions.verify_caption", return_value=None),
            ):
                run_verify_captions_job(root)

        self.assertEqual(client.close_count, 1)


class CloseModelClientTests(unittest.TestCase):
    def test_closes_a_client_that_supports_it(self) -> None:
        closed = []
        client = type("Client", (), {"close": lambda _self: closed.append(1)})()

        close_model_client(client)

        self.assertEqual(closed, [1])

    def test_ignores_a_client_without_close(self) -> None:
        close_model_client(object())

    def test_swallows_a_failing_close(self) -> None:
        def boom(_self: object) -> None:
            raise OSError("socket already gone")

        close_model_client(type("Client", (), {"close": boom})())


class EmptyCompletionDiagnosticsTests(unittest.TestCase):
    """A 200 that carries no caption has to say so; it used to return None in silence."""

    @staticmethod
    def _response(**overrides: object) -> dict:
        message = {"content": "", "reasoning_content": "", **overrides.pop("message", {})}
        return {
            "choices": [{"finish_reason": "stop", "message": message}],
            "usage": {"prompt_tokens": 997, "completion_tokens": 0},
            **overrides,
        }

    def test_describes_the_fields_that_separate_the_causes(self) -> None:
        detail = describe_empty_completion(self._response())

        self.assertIn("finish_reason=stop", detail)
        self.assertIn("prompt_tokens=997", detail)
        self.assertIn("completion_tokens=0", detail)
        self.assertIn("content_chars=0", detail)

    def test_reports_reasoning_that_consumed_the_budget(self) -> None:
        detail = describe_empty_completion(
            self._response(
                message={"reasoning_content": "x" * 4096},
                usage={"prompt_tokens": 6591, "completion_tokens": 8192},
            )
        )

        self.assertIn("reasoning_chars=4096", detail)
        self.assertIn("completion_tokens=8192", detail)

    def test_survives_a_response_with_no_choices(self) -> None:
        self.assertIn("no choices", describe_empty_completion({"choices": []}))

    def test_run_chat_completion_logs_the_empty_response(self) -> None:
        client = _StubClient(self._response())

        with self.assertLogs("automation.llm", level="ERROR") as logs:
            self.assertIsNone(run_chat_completion(client, [], mode="thinking"))

        self.assertIn("finish_reason=stop", logs.output[0])
        self.assertIn("prompt_tokens=997", logs.output[0])


class DescribeExceptionTests(unittest.TestCase):
    """``str(exc)`` alone is what made a dead server look like an unexplained failure."""

    def test_includes_the_type_and_the_cause_chain(self) -> None:
        try:
            try:
                raise ConnectionResetError(10054, "existing connection was forcibly closed")
            except ConnectionResetError as cause:
                raise RuntimeError("Connection error.") from cause
        except RuntimeError as exc:
            detail = describe_exception(exc)

        self.assertIn("RuntimeError: Connection error.", detail)
        self.assertIn("ConnectionResetError", detail)
        self.assertIn("forcibly closed", detail)

    def test_includes_http_status_and_body(self) -> None:
        class StatusError(Exception):
            status_code: ClassVar[int] = 400
            body: ClassVar[dict] = {"error": {"message": "context size exceeded"}}

        detail = describe_exception(StatusError("Bad request"))

        self.assertIn("[HTTP 400]", detail)
        self.assertIn("context size exceeded", detail)

    def test_run_chat_completion_logs_the_failure(self) -> None:
        client = _RaisingClient(RuntimeError("boom"))

        with self.assertLogs("automation.llm", level="ERROR") as logs:
            self.assertIsNone(run_chat_completion(client, [], mode="thinking"))

        self.assertIn("RuntimeError: boom", logs.output[0])


class _StubCompletions:
    def __init__(self, response: object) -> None:
        self._response = response

    def create(self, **_kwargs: object) -> object:
        return self._response


class _StubClient:
    def __init__(self, response: object) -> None:
        self.chat = type("Chat", (), {"completions": _StubCompletions(response)})()


class _RaisingCompletions:
    def __init__(self, error: Exception) -> None:
        self._error = error

    def create(self, **_kwargs: object) -> object:
        raise self._error


class _RaisingClient:
    def __init__(self, error: Exception) -> None:
        self.chat = type("Chat", (), {"completions": _RaisingCompletions(error)})()
