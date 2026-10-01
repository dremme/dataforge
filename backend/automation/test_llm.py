from __future__ import annotations

import threading
import time
import unittest
from types import SimpleNamespace
from typing import ClassVar
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from app_settings import SETTING_DEFAULTS
from automation.llm import (
    _STRIPPED_PREFIXES,
    API_ERROR,
    CANCEL_POLL_SECONDS,
    CANCELLED,
    INSTRUCT_THINK_PREFILL,
    MAX_MODEL_ATTEMPTS,
    SUCCESS,
    ModelOutcome,
    call_with_retries,
    clean_model_text,
    close_model_client,
    describe_empty_completion,
    describe_exception,
    model_client,
    run_chat_completion,
    strip_code_fences,
)
from testing_fixtures import (
    FakeChatClient,
    TempMediaFolder,
    write_media,
    write_sysprompt,
    write_txt_caption,
)

# Long enough that hitting it means cancellation did not drop the request.
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
            # Once for the hanging request, once when the run scope ended.
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


class UnreadableCaptionTests(unittest.TestCase):
    def test_every_model_job_counts_an_unreadable_caption_as_a_read_error(self) -> None:
        from automation.auto_caption import run_auto_caption_job
        from automation.edit_captions import run_edit_captions_job
        from automation.verify_captions import run_verify_captions_job

        jobs = {
            "auto_caption": run_auto_caption_job,
            "verify_captions": run_verify_captions_job,
            "edit_captions": lambda root: run_edit_captions_job(root, instruction="Shorten it."),
        }
        for name, run in jobs.items():
            with (
                self.subTest(job=name),
                TempMediaFolder() as root,
                patch("captions._read_caption_text", return_value=None),
                patch("automation.llm.create_openai_client"),
            ):
                write_sysprompt(root, "Describe the scene.")
                write_txt_caption(write_media(root, "photo.png"), "Draft.")

                result = run(root)

                self.assertEqual(result["stats"]["read_error"], 1)
                self.assertEqual(result["results"][0]["status"], "read_error")
                self.assertEqual(result["processed"], 1)


class CallWithRetriesTests(unittest.TestCase):
    def test_every_attempt_is_handed_its_own_number(self) -> None:
        seen: list[int] = []

        def attempt(number: int) -> ModelOutcome[str]:
            seen.append(number)
            return ModelOutcome(status=API_ERROR)

        call_with_retries(attempt, job_label="Auto-caption", media_name="clip.mp4")

        self.assertEqual(seen, list(range(1, MAX_MODEL_ATTEMPTS + 1)))

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

    def test_a_completed_job_does_not_keep_its_client(self) -> None:
        from automation.auto_caption import run_auto_caption_job
        from automation.verify_captions import run_verify_captions_job

        jobs = (
            (run_auto_caption_job, "automation.auto_caption.complete_caption"),
            (run_verify_captions_job, "automation.verify_captions.verify_caption"),
        )
        for run, model_call in jobs:
            client = self._SpyClient()
            with (
                self.subTest(job=run.__name__),
                TempMediaFolder() as root,
                patch("automation.llm.create_openai_client", return_value=client),
                patch(model_call, return_value=None),
            ):
                write_sysprompt(root, "Describe the scene.")
                write_txt_caption(write_media(root, "photo.png"), "Draft.")

                run(root)

                self.assertEqual(client.close_count, 1)


class RunChatCompletionTests(unittest.TestCase):
    MESSAGES: ClassVar[list[dict]] = [
        {"role": "system", "content": "Caption."},
        {"role": "user", "content": "Go."},
    ]

    def test_each_mode_sends_its_own_sampling_profile(self) -> None:
        for mode in ("thinking", "instruct"):
            with self.subTest(mode=mode):
                client = FakeChatClient("A red hatchback.")

                run_chat_completion(client, self.MESSAGES, mode=mode)

                sent = client.last
                self.assertEqual(
                    sent["temperature"], getattr(SETTING_DEFAULTS, f"{mode}_temperature")
                )
                self.assertEqual(sent["top_p"], getattr(SETTING_DEFAULTS, f"{mode}_top_p"))
                self.assertEqual(
                    sent["presence_penalty"], getattr(SETTING_DEFAULTS, f"{mode}_presence_penalty")
                )
                self.assertEqual(sent["model"], SETTING_DEFAULTS.vision_model)
                self.assertEqual(sent["max_tokens"], SETTING_DEFAULTS.vision_max_tokens)

    def test_only_instruct_prefills_an_empty_thinking_block(self) -> None:
        thinking = FakeChatClient("A red hatchback.")
        instruct = FakeChatClient("A red hatchback.")

        run_chat_completion(thinking, self.MESSAGES, mode="thinking")
        run_chat_completion(instruct, self.MESSAGES, mode="instruct")

        self.assertEqual(thinking.last["messages"], self.MESSAGES)
        self.assertEqual(
            instruct.last["messages"][-1], {"role": "assistant", "content": INSTRUCT_THINK_PREFILL}
        )

    def test_only_instruct_falls_back_to_the_reasoning_text(self) -> None:
        """Thinking-mode chain-of-thought must never be taken for the answer."""
        for mode, expected in (("instruct", "A red hatchback."), ("thinking", None)):
            with self.subTest(mode=mode):
                client = FakeChatClient("", reasoning_content="A red hatchback.")

                self.assertEqual(run_chat_completion(client, self.MESSAGES, mode=mode), expected)


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
        response = self._response()
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **_kwargs: response))
        )

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
        client = FakeChatClient(raises=RuntimeError("boom"))

        with self.assertLogs("automation.llm", level="ERROR") as logs:
            self.assertIsNone(run_chat_completion(client, [], mode="thinking"))

        self.assertIn("RuntimeError: boom", logs.output[0])


class CleanModelTextTests(unittest.TestCase):
    def test_strips_each_prefix(self) -> None:
        for prefix in _STRIPPED_PREFIXES:
            with self.subTest(prefix=prefix):
                self.assertEqual(clean_model_text(f"{prefix} a red hatchback"), "a red hatchback")

    def test_strips_a_thinking_block(self) -> None:
        self.assertEqual(clean_model_text("<think>hmm</think>a red hatchback"), "a red hatchback")

    def test_strips_a_code_fence(self) -> None:
        self.assertEqual(strip_code_fences("```\na red hatchback\n```"), "a red hatchback")

    def test_strips_a_chat_template_marker(self) -> None:
        self.assertEqual(clean_model_text("a red hatchback<|im_end|>"), "a red hatchback")
