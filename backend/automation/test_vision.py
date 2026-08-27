from __future__ import annotations

import base64
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from PIL import Image

from automation.llm import (
    API_ERROR,
    MAX_MODEL_ATTEMPTS,
    ModelOutcome,
    call_with_retries,
)
from automation.vision import (
    FRAME_ERROR,
    IMAGE_MAX_PIXELS,
    IMAGE_MAX_PIXELS_VAR,
    JPEG_QUALITY,
    KEYFRAMES_PER_SECOND,
    KEYFRAMES_PER_SECOND_VAR,
    MAX_VIDEO_KEYFRAME_COUNT,
    MAX_VIDEO_KEYFRAMES_VAR,
    MIN_HONORED_MAX_PIXELS,
    READ_ERROR,
    VIDEO_FRAME_MAX_PIXELS,
    VIDEO_FRAME_MAX_PIXELS_VAR,
    VIDEO_FRAME_MIN_PIXELS_VAR,
    VIDEO_FRAME_SCALE_END_SECONDS,
    VIDEO_FRAME_SCALE_START_SECONDS,
    VIDEO_KEYFRAME_COUNT,
    get_image_max_pixels,
    get_keyframes_per_second,
    get_max_video_keyframes,
    get_qwen_min_side_px,
    get_video_frame_max_pixels,
    get_video_frame_min_pixels,
    keyframe_count_for_seconds,
    keyframe_sentence,
    load_image_rgb,
    load_media_images,
    media_kind_for,
    media_kind_max_pixels,
    request_vision_text,
    resize_for_qwen,
    retry_jpeg_quality,
    video_frame_max_pixels_for_seconds,
    vision_messages,
)
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_media,
)

# Long enough that a test hitting it means cancellation did not drop the request.
WEDGED_SERVER_SECONDS = 30.0
# Cancellation polls every 100ms, so a working drop lands far inside this.
CANCEL_DEADLINE_SECONDS = 5.0


class RetryReencodeWorkaroundTests(unittest.TestCase):
    """A retry must not resend the exact bytes that just failed - see ``retry_jpeg_quality``."""

    def test_every_attempt_is_handed_its_own_number(self) -> None:
        seen: list[int] = []

        def attempt(number: int) -> ModelOutcome[str]:
            seen.append(number)
            return ModelOutcome(status=API_ERROR)

        call_with_retries(attempt, job_label="Auto-caption", media_name="clip.mp4")

        self.assertEqual(seen, list(range(1, MAX_MODEL_ATTEMPTS + 1)))

    def test_each_attempt_gets_its_own_quality(self) -> None:
        qualities = [retry_jpeg_quality(number) for number in range(1, MAX_MODEL_ATTEMPTS + 1)]

        self.assertEqual(len(set(qualities)), len(qualities))
        self.assertTrue(all(quality > 0 for quality in qualities))

    def _sent_images(self, attempt: int) -> list[str]:
        """The base64 payloads one attempt puts on the wire."""
        captured: dict = {}

        class FakeCompletions:
            def create(self, **kwargs: object) -> object:
                parts = kwargs["messages"][1]["content"]
                captured["images"] = [
                    part["image_url"]["url"] for part in parts if part["type"] == "image_url"
                ]
                message = type("Message", (), {"content": "text", "reasoning_content": None})()
                choice = type("Choice", (), {"message": message})()
                return type("Response", (), {"choices": [choice]})()

        client = type(
            "FakeClient", (), {"chat": type("Chat", (), {"completions": FakeCompletions()})()}
        )()
        request_vision_text(
            client,
            "System prompt",
            [Image.new("RGB", (64, 64), color="blue")],
            "Caption it.",
            max_pixels=IMAGE_MAX_PIXELS,
            mode="instruct",
            attempt=attempt,
        )
        return captured["images"]

    def test_a_retry_sends_different_bytes_than_the_attempt_that_failed(self) -> None:
        # Byte-identical repeats are short-circuited, so a retry that resends them is not a second attempt.
        first = self._sent_images(1)
        second = self._sent_images(2)

        self.assertEqual(len(first), len(second))
        self.assertNotEqual(first, second)

    def test_the_first_attempt_is_unchanged_by_the_workaround(self) -> None:
        # Only retries differ; a first attempt at another quality would change every request.
        self.assertEqual(retry_jpeg_quality(1), JPEG_QUALITY)


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
        # Pillow keeps the handle open on multi-frame files; an APNG (plain .png) catches that.
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
        # Gallery still treats a GIF as a gif; only captioning folds it in with stills.
        for name in ("loop.gif", "LOOP.GIF"):
            self.assertEqual(media_kind_for(Path(name)), "image")


class KeyframeCountTests(unittest.TestCase):
    """A clip gets two samples a second plus its endpoints, within a floor and a cap."""

    def test_scales_with_the_clip_length(self) -> None:
        self.assertEqual(keyframe_count_for_seconds(6), 14)
        self.assertEqual(keyframe_count_for_seconds(10), 22)
        self.assertEqual(keyframe_count_for_seconds(20), 42)

    def test_a_part_second_counts_as_a_whole_one(self) -> None:
        # Rounding down would leave the last fraction of a second unsampled.
        self.assertEqual(keyframe_count_for_seconds(10.0), 22)
        self.assertEqual(keyframe_count_for_seconds(10.4), 24)

    def test_a_short_clip_keeps_the_fixed_count(self) -> None:
        # The formula alone would hand a 1s clip four frames; the floor keeps short clips unchanged.
        for seconds in (0.5, 1, 3):
            self.assertEqual(keyframe_count_for_seconds(seconds), VIDEO_KEYFRAME_COUNT)

        self.assertEqual(keyframe_count_for_seconds(5.0), 12)
        self.assertEqual(keyframe_count_for_seconds(6.0), 14)

    def test_a_long_clip_stops_at_the_cap(self) -> None:
        # Uncapped frames are inlined (and retried); 2 * 20s + 2 is the cap.
        self.assertEqual(keyframe_count_for_seconds(20), MAX_VIDEO_KEYFRAME_COUNT)
        self.assertEqual(keyframe_count_for_seconds(31), MAX_VIDEO_KEYFRAME_COUNT)
        for seconds in (32, 60, 300):
            self.assertEqual(keyframe_count_for_seconds(seconds), MAX_VIDEO_KEYFRAME_COUNT)

    def test_an_unusable_duration_falls_back_to_the_fixed_count(self) -> None:
        for seconds in (None, 0, -5, float("nan"), float("inf")):
            self.assertEqual(keyframe_count_for_seconds(seconds), VIDEO_KEYFRAME_COUNT)


class FrameBudgetEnvTests(unittest.TestCase):
    """The sampling schedule is configurable, and every knob is read per call."""

    def test_the_defaults_are_what_the_pinned_counts_already_assert(self) -> None:
        # The rest of the suite hard-codes 14/22/42; 42 is also the default cap.
        self.assertEqual(get_keyframes_per_second(), KEYFRAMES_PER_SECOND)
        self.assertEqual(get_max_video_keyframes(), MAX_VIDEO_KEYFRAME_COUNT)
        self.assertEqual(get_video_frame_max_pixels(), VIDEO_FRAME_MAX_PIXELS)
        self.assertEqual(get_video_frame_min_pixels(), MIN_HONORED_MAX_PIXELS)
        self.assertEqual(get_qwen_min_side_px(), 512)
        self.assertEqual(get_image_max_pixels(), IMAGE_MAX_PIXELS)

    def test_a_higher_rate_samples_a_clip_more_densely(self) -> None:
        with patch.dict(os.environ, {KEYFRAMES_PER_SECOND_VAR: "4"}):
            self.assertEqual(keyframe_count_for_seconds(6), 26)
            self.assertEqual(keyframe_count_for_seconds(10), 42)

    def test_a_raised_cap_lets_a_long_clip_past_the_default(self) -> None:
        with patch.dict(os.environ, {MAX_VIDEO_KEYFRAMES_VAR: "128"}):
            self.assertEqual(keyframe_count_for_seconds(60), 122)
            self.assertEqual(keyframe_count_for_seconds(300), 128)

    def test_the_floor_still_applies_under_a_raised_cap(self) -> None:
        with patch.dict(os.environ, {MAX_VIDEO_KEYFRAMES_VAR: "128"}):
            self.assertEqual(keyframe_count_for_seconds(1), VIDEO_KEYFRAME_COUNT)

    def test_a_lowered_cap_wins_over_the_floor(self) -> None:
        # The cap keeps the request tractable, so it is the last word.
        with patch.dict(os.environ, {MAX_VIDEO_KEYFRAMES_VAR: "8"}):
            self.assertEqual(keyframe_count_for_seconds(1), 8)

    def test_a_value_that_would_send_nothing_is_ignored(self) -> None:
        # A cap of zero comes back as a caption of nothing rather than as an error.
        for raw in ("0", "-4", "", "   ", "many", "2.5"):
            with patch.dict(os.environ, {MAX_VIDEO_KEYFRAMES_VAR: raw}):
                self.assertEqual(get_max_video_keyframes(), MAX_VIDEO_KEYFRAME_COUNT)
            with patch.dict(os.environ, {KEYFRAMES_PER_SECOND_VAR: raw}):
                self.assertEqual(get_keyframes_per_second(), KEYFRAMES_PER_SECOND)
            with patch.dict(os.environ, {VIDEO_FRAME_MAX_PIXELS_VAR: raw}):
                self.assertEqual(get_video_frame_max_pixels(), VIDEO_FRAME_MAX_PIXELS)
            with patch.dict(os.environ, {VIDEO_FRAME_MIN_PIXELS_VAR: raw}):
                self.assertEqual(get_video_frame_min_pixels(), MIN_HONORED_MAX_PIXELS)
            with patch.dict(os.environ, {IMAGE_MAX_PIXELS_VAR: raw}):
                self.assertEqual(get_image_max_pixels(), IMAGE_MAX_PIXELS)

    def test_each_media_kind_reads_its_own_configured_budget(self) -> None:
        # Neither knob may be bound at import.
        with patch.dict(
            os.environ,
            {IMAGE_MAX_PIXELS_VAR: "900000", VIDEO_FRAME_MAX_PIXELS_VAR: "262144"},
        ):
            self.assertEqual(media_kind_max_pixels("image"), 900_000)
            self.assertEqual(media_kind_max_pixels("video"), 262_144)

    def test_the_two_budgets_are_independent(self) -> None:
        # Setting the video knob must not drag the still one down with it.
        with patch.dict(os.environ, {VIDEO_FRAME_MAX_PIXELS_VAR: "262144"}):
            self.assertEqual(media_kind_max_pixels("image"), IMAGE_MAX_PIXELS)


class VideoFramePixelScaleTests(unittest.TestCase):
    """Per-frame size shrinks between 7s and 20s so a long clip still fits one request."""

    def test_a_short_clip_keeps_the_full_budget(self) -> None:
        for seconds in (None, 0.5, 7.0, VIDEO_FRAME_SCALE_START_SECONDS):
            self.assertEqual(video_frame_max_pixels_for_seconds(seconds), VIDEO_FRAME_MAX_PIXELS)
            self.assertEqual(
                media_kind_max_pixels("video", seconds=seconds), VIDEO_FRAME_MAX_PIXELS
            )

    def test_a_twenty_second_clip_is_at_the_resize_floor(self) -> None:
        for seconds in (20.0, VIDEO_FRAME_SCALE_END_SECONDS, 21, 60, 300):
            self.assertEqual(video_frame_max_pixels_for_seconds(seconds), MIN_HONORED_MAX_PIXELS)

    def test_the_shrink_is_gradual_between_the_ends(self) -> None:
        ten = video_frame_max_pixels_for_seconds(10)
        self.assertEqual(ten, 445_110)
        self.assertGreater(ten, MIN_HONORED_MAX_PIXELS)
        self.assertLess(ten, VIDEO_FRAME_MAX_PIXELS)
        midpoint = video_frame_max_pixels_for_seconds(13.5)
        self.assertLess(midpoint, ten)
        self.assertGreater(midpoint, MIN_HONORED_MAX_PIXELS)
        self.assertGreater(ten, video_frame_max_pixels_for_seconds(15))

    def test_an_unusable_duration_keeps_the_full_budget(self) -> None:
        for seconds in (0, -5, float("nan"), float("inf")):
            self.assertEqual(video_frame_max_pixels_for_seconds(seconds), VIDEO_FRAME_MAX_PIXELS)

    def test_a_configured_budget_is_what_a_short_clip_starts_from(self) -> None:
        with patch.dict(os.environ, {VIDEO_FRAME_MAX_PIXELS_VAR: "400000"}):
            self.assertEqual(video_frame_max_pixels_for_seconds(7), 400_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), MIN_HONORED_MAX_PIXELS)
            self.assertEqual(media_kind_max_pixels("video", seconds=10), 368_187)

    def test_a_budget_already_at_the_floor_does_not_grow_for_a_long_clip(self) -> None:
        with patch.dict(os.environ, {VIDEO_FRAME_MAX_PIXELS_VAR: "125000"}):
            self.assertEqual(video_frame_max_pixels_for_seconds(7), 125_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 125_000)

    def test_stills_ignore_the_clip_span(self) -> None:
        self.assertEqual(media_kind_max_pixels("image", seconds=60), IMAGE_MAX_PIXELS)

    def test_a_configured_min_is_what_a_long_clip_lands_on(self) -> None:
        with patch.dict(os.environ, {VIDEO_FRAME_MIN_PIXELS_VAR: "300000"}):
            self.assertEqual(get_video_frame_min_pixels(), 300_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(7), VIDEO_FRAME_MAX_PIXELS)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 300_000)
            self.assertEqual(media_kind_max_pixels("video", seconds=10), 453_846)

    def test_a_configured_min_and_max_lerp_together(self) -> None:
        with patch.dict(
            os.environ,
            {VIDEO_FRAME_MAX_PIXELS_VAR: "400000", VIDEO_FRAME_MIN_PIXELS_VAR: "300000"},
        ):
            self.assertEqual(video_frame_max_pixels_for_seconds(7), 400_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 300_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(10), 376_923)

    def test_a_lowered_min_lets_the_resize_go_below_five_hundred_twelve(self) -> None:
        with patch.dict(os.environ, {VIDEO_FRAME_MIN_PIXELS_VAR: "65536"}):
            self.assertEqual(get_qwen_min_side_px(), 256)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 65_536)
            resized = resize_for_qwen(
                Image.new("RGB", (1200, 1200), color="blue"),
                max_pixels=video_frame_max_pixels_for_seconds(20),
            )
            self.assertEqual(resized.size, (256, 256))


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
        # Spelling and one decimal place are the Qwen3-VL contract, not a style choice.
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
        # Half-labelled frames would attach each timestamp to the wrong frame.
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
        # Jobs surface this message as the file's result, so a read_error without one says nothing.
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
        # GIFs take the still path, so they land with stills rather than the frame extractor.
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


if __name__ == "__main__":
    unittest.main()
