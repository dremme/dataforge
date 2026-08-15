"""Unit tests for the shared vision plumbing, focused on cancelling a stuck model call."""

from __future__ import annotations

import base64
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from PIL import Image

from automation.vision import (
    API_ERROR,
    CANCEL_POLL_SECONDS,
    CANCELLED,
    FRAME_ERROR,
    MAX_VIDEO_KEYFRAME_COUNT,
    READ_ERROR,
    SUCCESS,
    VIDEO_KEYFRAME_COUNT,
    ModelOutcome,
    call_with_retries,
    close_vision_client,
    keyframe_count_for_seconds,
    keyframe_sentence,
    load_image_rgb,
    load_media_images,
    media_kind_for,
    vision_client,
    vision_messages,
)
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
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
            "automation.vision.create_openai_client",
        )

    def test_verify_captions_cancels_without_waiting_for_the_model(self) -> None:
        from automation.verify_captions import run_verify_captions_job

        def folder_setup(root) -> None:
            write_txt_caption(write_media(root, "photo.png"), "A caption to verify.")

        self._assert_drops_in_flight_request(
            lambda root, should_cancel: run_verify_captions_job(root, should_cancel=should_cancel),
            folder_setup,
            "automation.vision.create_openai_client",
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

            with patch("automation.vision.create_openai_client", return_value=client):
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


class LoadImageRgbTests(unittest.TestCase):
    """The job must not sit on an open handle: on Windows that locks the media."""

    def _handles_from(self, path) -> list[object]:
        """Run ``load_image_rgb``, returning the file objects Pillow opened for it."""
        opened: list[object] = []
        real_open = Image.open

        def spy(*args: object, **kwargs: object) -> Image.Image:
            image = real_open(*args, **kwargs)
            opened.append(image.fp)
            return image

        with patch("automation.vision.Image.open", spy):
            images, error = load_image_rgb(path)

        self.assertIsNone(error)
        self.assertIsNotNone(images)
        self.assertTrue(opened, "expected load_image_rgb to open the media")
        return opened

    def test_closes_the_file_for_a_single_frame_image(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")

            for handle in self._handles_from(media):
                self.assertTrue(handle is None or handle.closed)

    def test_closes_the_file_for_a_multi_frame_image(self) -> None:
        # Pillow keeps the handle open past load() so later frames stay seekable,
        # so an APNG (still a plain .png to the rest of the app) is what catches a
        # regression here; a single-frame PNG closes itself either way.
        with TempMediaFolder() as root:
            media = root / "animated.png"
            frames = [Image.new("RGB", (32, 32), color=tone) for tone in ("red", "green")]
            frames[0].save(media, save_all=True, append_images=frames[1:], duration=100)

            for handle in self._handles_from(media):
                self.assertTrue(handle is None or handle.closed)

    def test_returns_usable_pixels_after_the_source_is_closed(self) -> None:
        with TempMediaFolder() as root:
            media = root / "swatch.png"
            Image.new("RGB", (8, 8), color="red").save(media)

            images, error = load_image_rgb(media)

            self.assertIsNone(error)
            assert images is not None
            self.assertEqual(images[0].mode, "RGB")
            self.assertEqual(images[0].getpixel((0, 0)), (255, 0, 0))

    def test_reports_a_read_error_without_raising(self) -> None:
        with TempMediaFolder() as root:
            broken = root / "broken.png"
            broken.write_bytes(b"not an image")

            images, error = load_image_rgb(broken)

            self.assertIsNone(images)
            self.assertIsNotNone(error)


class MediaKindTests(unittest.TestCase):
    def test_stills_are_images(self) -> None:
        for name in ("photo.png", "photo.JPG", "photo.jpeg"):
            self.assertEqual(media_kind_for(Path(name)), "image")

    def test_videos_are_video(self) -> None:
        for name in ("clip.mp4", "CLIP.MOV", "clip.mkv"):
            self.assertEqual(media_kind_for(Path(name)), "video")

    def test_gifs_are_images(self) -> None:
        # The rendering layer still calls a GIF a gif and the gallery still scrubs
        # its frames; only the captioning axis folds it in with the stills.
        for name in ("loop.gif", "LOOP.GIF"):
            self.assertEqual(media_kind_for(Path(name)), "image")


class KeyframeCountTests(unittest.TestCase):
    """A clip gets two samples a second plus its endpoints, within a floor and a cap."""

    def test_scales_with_the_clip_length(self) -> None:
        self.assertEqual(keyframe_count_for_seconds(6), 14)
        self.assertEqual(keyframe_count_for_seconds(10), 22)
        self.assertEqual(keyframe_count_for_seconds(20), 42)

    def test_a_part_second_counts_as_a_whole_one(self) -> None:
        # Rounding down would leave the last fraction of a second unsampled, so the
        # boundary is pinned against a later int() or round() creeping in.
        self.assertEqual(keyframe_count_for_seconds(10.0), 22)
        self.assertEqual(keyframe_count_for_seconds(10.4), 24)

    def test_a_short_clip_keeps_the_fixed_count(self) -> None:
        # The formula alone would hand a 1s clip four frames, which is fewer than it
        # gets today. Below the floor nothing about a short clip changes.
        for seconds in (0.5, 1, 3, 5.0):
            self.assertEqual(keyframe_count_for_seconds(seconds), VIDEO_KEYFRAME_COUNT)

        self.assertEqual(keyframe_count_for_seconds(6.0), 14)

    def test_a_long_clip_stops_at_the_cap(self) -> None:
        # Every frame is inlined in one request, so an uncapped count would build a
        # payload no model accepts - and retry it.
        self.assertEqual(keyframe_count_for_seconds(31), MAX_VIDEO_KEYFRAME_COUNT)
        for seconds in (32, 60, 300):
            self.assertEqual(keyframe_count_for_seconds(seconds), MAX_VIDEO_KEYFRAME_COUNT)

    def test_an_unusable_duration_falls_back_to_the_fixed_count(self) -> None:
        for seconds in (None, 0, -5, float("nan"), float("inf")):
            self.assertEqual(keyframe_count_for_seconds(seconds), VIDEO_KEYFRAME_COUNT)


class KeyframeSentenceTests(unittest.TestCase):
    def test_states_the_real_frame_count(self) -> None:
        sentence = keyframe_sentence(5)

        self.assertIn("5 keyframes", sentence)
        self.assertNotIn(f"{VIDEO_KEYFRAME_COUNT} keyframes", sentence)

    def test_a_lone_frame_is_singular(self) -> None:
        self.assertIn("a single frame", keyframe_sentence(1).lower())
        # A still carries no span even if one were offered.
        self.assertIn("a single frame", keyframe_sentence(1, 4.0).lower())

    def test_an_unknown_span_reads_exactly_as_it_did_before_timestamps(self) -> None:
        """The streamed-video and delay-less-GIF paths must not shift under them."""
        self.assertEqual(
            keyframe_sentence(5),
            "You are given 5 keyframes in chronological order. "
            "Analyze the full video sequence while following the system instructions.",
        )

    def test_a_known_span_states_the_length_and_the_labels(self) -> None:
        sentence = keyframe_sentence(18, 8.0)

        self.assertIn("18 keyframes", sentence)
        self.assertIn("8.0 seconds", sentence)
        # The markers between the frames are otherwise unexplained tokens.
        self.assertIn("labelled with its timestamp", sentence)


class VisionMessagesTests(unittest.TestCase):
    """The request envelope, which is the contract with the model server."""

    def test_frames_come_first_and_the_instruction_last(self) -> None:
        messages = vision_messages("Sys", ["aaa", "bbb"], "Caption it.")

        self.assertEqual([m["role"] for m in messages], ["system", "user"])
        self.assertEqual(messages[0]["content"], "Sys")
        self.assertEqual(
            [part["type"] for part in messages[1]["content"]],
            ["image_url", "image_url", "text"],
        )
        self.assertEqual(
            messages[1]["content"][0]["image_url"]["url"],
            "data:image/jpeg;base64,aaa",
        )
        self.assertEqual(messages[1]["content"][-1]["text"], "Caption it.")

    def test_no_audio_leaves_the_request_exactly_as_it_was(self) -> None:
        """Every caller but an audio auto-caption relies on this staying unchanged."""
        baseline = vision_messages("Sys", ["aaa"], "Caption it.")

        self.assertEqual(vision_messages("Sys", ["aaa"], "Caption it.", audio_wav=None), baseline)
        self.assertEqual(vision_messages("Sys", ["aaa"], "Caption it.", audio_wav=b""), baseline)

    def test_a_timestamp_precedes_every_frame(self) -> None:
        # Qwen3-VL's own video path emits this marker before each frame, so the
        # spelling and the single decimal place are the contract, not a style choice.
        messages = vision_messages("Sys", ["aaa", "bbb"], "Caption it.", timestamps=[0.0, 3.26])

        parts = messages[1]["content"]
        self.assertEqual(
            [part["type"] for part in parts],
            ["text", "image_url", "text", "image_url", "text"],
        )
        self.assertEqual(parts[0]["text"], "<0.0 seconds>")
        self.assertEqual(parts[2]["text"], "<3.3 seconds>")
        self.assertEqual(parts[-1]["text"], "Caption it.")

    def test_no_timestamps_leaves_the_request_exactly_as_it_was(self) -> None:
        """Stills, streamed clips and delay-less GIFs all stay on the old envelope."""
        baseline = vision_messages("Sys", ["aaa"], "Caption it.")

        self.assertEqual(vision_messages("Sys", ["aaa"], "Caption it.", timestamps=None), baseline)
        self.assertEqual(vision_messages("Sys", ["aaa"], "Caption it.", timestamps=[]), baseline)

    def test_a_timestamp_per_frame_mismatch_labels_nothing(self) -> None:
        # Half-labelled frames would silently attach each timestamp to the wrong
        # frame, which is worse than sending none.
        baseline = vision_messages("Sys", ["aaa", "bbb"], "Caption it.")

        self.assertEqual(
            vision_messages("Sys", ["aaa", "bbb"], "Caption it.", timestamps=[0.0]),
            baseline,
        )

    def test_timestamps_and_audio_coexist(self) -> None:
        messages = vision_messages(
            "Sys",
            ["aaa"],
            "Caption it.",
            timestamps=[1.5],
            audio_wav=b"wav bytes",
        )

        self.assertEqual(
            [part["type"] for part in messages[1]["content"]],
            ["text", "image_url", "input_audio", "text"],
        )

    def test_audio_sits_between_the_frames_and_the_instruction(self) -> None:
        messages = vision_messages("Sys", ["aaa"], "Caption it.", audio_wav=b"wav bytes")

        parts = messages[1]["content"]
        self.assertEqual([part["type"] for part in parts], ["image_url", "input_audio", "text"])
        self.assertEqual(
            parts[1],
            {
                "type": "input_audio",
                "input_audio": {
                    "data": base64.b64encode(b"wav bytes").decode("utf-8"),
                    "format": "wav",
                },
            },
        )


class LoadMediaImagesTests(unittest.TestCase):
    """``status`` is the job counter the file lands in, so its value is the contract."""

    def test_a_still_loads_as_one_frame(self) -> None:
        with TempMediaFolder() as root:
            frames, error = load_media_images(write_media(root, "photo.png"))

            self.assertIsNone(error)
            assert frames is not None
            self.assertEqual(len(frames.images), 1)
            # One frame has no timeline to place it on, so the request stays unlabelled.
            self.assertIsNone(frames.timestamps)

    def test_an_unreadable_still_reports_read_error_with_a_message(self) -> None:
        # The jobs surface this message as the file's result, so a read_error without
        # one would report the failure without saying why.
        with TempMediaFolder() as root:
            broken = root / "broken.png"
            broken.write_bytes(b"not an image")

            images, error = load_media_images(broken)

            self.assertIsNone(images)
            assert error is not None
            self.assertEqual(error.status, READ_ERROR)
            self.assertTrue(error.message)

    def test_a_gif_loads_as_its_opening_frame_alone(self) -> None:
        with TempMediaFolder() as root:
            frames, error = load_media_images(write_gif(root, "loop.gif", frames=8))

            self.assertIsNone(error)
            assert frames is not None
            self.assertEqual(len(frames.images), 1)
            # One frame is a still, and a still has no timeline to label it against.
            self.assertIsNone(frames.timestamps)

    def test_a_gif_loads_without_opencv(self) -> None:
        # cv2 reports a frame count of zero for many GIFs, so it never sees one.
        def explode(_path: str) -> None:
            raise AssertionError("OpenCV must not be used to read a GIF")

        fake_cv2 = type("cv2", (), {"VideoCapture": staticmethod(explode)})

        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif", frames=8)

            with patch.dict("sys.modules", {"cv2": fake_cv2}):
                frames, error = load_media_images(media)

        self.assertIsNone(error)
        assert frames is not None
        self.assertEqual(len(frames.images), 1)

    def test_an_unreadable_gif_reports_read_error(self) -> None:
        # It reaches the still path now, so it lands with the stills rather than
        # under the frame extractor's counter.
        with TempMediaFolder() as root:
            broken = root / "broken.gif"
            broken.write_bytes(b"not a gif")

            frames, error = load_media_images(broken)

            self.assertIsNone(frames)
            assert error is not None
            self.assertEqual(error.status, READ_ERROR)
            self.assertTrue(error.message)

    def test_undecodable_motion_reports_frame_error_without_a_message(self) -> None:
        # The extractor logs the reason; the user gets the count.
        with TempMediaFolder() as root:
            broken = root / "broken.mp4"
            broken.write_bytes(b"not a video")

            images, error = load_media_images(broken)

            self.assertIsNone(images)
            assert error is not None
            self.assertEqual(error.status, FRAME_ERROR)
            self.assertIsNone(error.message)


class VisionClientScopeTests(unittest.TestCase):
    """A client holds a connection pool, so every run has to hand it back."""

    class _SpyClient:
        def __init__(self) -> None:
            self.close_count = 0

        def close(self) -> None:
            self.close_count += 1

    def test_closes_the_client_when_the_run_ends(self) -> None:
        client = self._SpyClient()

        with patch("automation.vision.create_openai_client", return_value=client):
            with vision_client() as scoped:
                self.assertIs(scoped, client)
                self.assertEqual(client.close_count, 0)

        self.assertEqual(client.close_count, 1)

    def test_closes_the_client_when_the_run_raises(self) -> None:
        client = self._SpyClient()

        with patch("automation.vision.create_openai_client", return_value=client):
            with self.assertRaises(ValueError), vision_client():
                raise ValueError("job blew up")

        self.assertEqual(client.close_count, 1)

    def test_a_completed_auto_caption_job_does_not_keep_its_client(self) -> None:
        client = self._SpyClient()

        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            from automation.auto_caption import run_auto_caption_job

            with (
                patch("automation.vision.create_openai_client", return_value=client),
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
                patch("automation.vision.create_openai_client", return_value=client),
                patch("automation.verify_captions.verify_caption", return_value=None),
            ):
                run_verify_captions_job(root)

        self.assertEqual(client.close_count, 1)


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
