from __future__ import annotations

import base64
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

import numpy
from PIL import Image

from app_settings import SETTING_DEFAULTS
from automation.llm import MAX_MODEL_ATTEMPTS
from automation.vision import (
    FRAME_ERROR,
    JPEG_QUALITY,
    QWEN_MIN_SIDE_PX,
    READ_ERROR,
    TAIL_SEEK_LIMIT,
    VIDEO_FRAME_SCALE_END_SECONDS,
    VIDEO_FRAME_SCALE_START_SECONDS,
    VIDEO_KEYFRAME_COUNT,
    MediaFrames,
    MediaLoadError,
    extract_video_keyframes,
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
from ffmpeg_bin import ffmpeg_path
from testing_fixtures import (
    FakeChatClient,
    TempMediaFolder,
    image_urls,
    write_gif,
    write_media,
    write_mp4_video,
)


class RetryReencodeWorkaroundTests(unittest.TestCase):
    """A retry must not resend the exact bytes that just failed - see ``retry_jpeg_quality``."""

    def test_each_attempt_gets_its_own_quality_starting_from_the_default(self) -> None:
        # Only retries differ; a first attempt at another quality would change every request.
        qualities = [retry_jpeg_quality(number) for number in range(1, MAX_MODEL_ATTEMPTS + 1)]

        self.assertEqual(qualities[0], JPEG_QUALITY)
        self.assertEqual(len(set(qualities)), len(qualities))
        self.assertTrue(all(quality > 0 for quality in qualities))

    def _sent_images(self, attempt: int) -> list[str]:
        """The base64 payloads one attempt puts on the wire."""
        client = FakeChatClient("text")
        request_vision_text(
            client,
            "System prompt",
            [Image.new("RGB", (64, 64), color="blue")],
            "Caption it.",
            max_pixels=SETTING_DEFAULTS.image_max_pixels,
            mode="instruct",
            attempt=attempt,
        )
        return image_urls(client.last["messages"])

    def test_a_retry_sends_different_bytes_than_the_attempt_that_failed(self) -> None:
        # Byte-identical repeats are short-circuited, so a retry that resends them is not a second attempt.
        first = self._sent_images(1)
        second = self._sent_images(2)

        self.assertEqual(len(first), len(second))
        self.assertNotEqual(first, second)


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


class MediaKindTests(unittest.TestCase):
    def test_stills_and_gifs_are_images_and_clips_are_video(self) -> None:
        # Gallery still treats a GIF as a gif; only captioning folds it in with stills.
        cases = {
            "image": ("photo.png", "photo.JPG", "photo.jpeg", "loop.gif", "LOOP.GIF"),
            "video": ("clip.mp4", "CLIP.MOV", "clip.mkv"),
        }
        for kind, names in cases.items():
            for name in names:
                with self.subTest(name=name):
                    self.assertEqual(media_kind_for(Path(name)), kind)


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
        self.assertEqual(keyframe_count_for_seconds(20), SETTING_DEFAULTS.video_max_keyframes)
        self.assertEqual(keyframe_count_for_seconds(31), SETTING_DEFAULTS.video_max_keyframes)
        for seconds in (32, 60, 300):
            self.assertEqual(
                keyframe_count_for_seconds(seconds), SETTING_DEFAULTS.video_max_keyframes
            )

    def test_an_unusable_duration_falls_back_to_the_fixed_count(self) -> None:
        for seconds in (None, 0, -5, float("nan"), float("inf")):
            self.assertEqual(keyframe_count_for_seconds(seconds), VIDEO_KEYFRAME_COUNT)


class FrameBudgetEnvTests(unittest.TestCase):
    """The sampling schedule is configurable, and every knob is read per call."""

    def test_a_higher_rate_samples_a_clip_more_densely(self) -> None:
        with patch.dict(os.environ, {"VIDEO_KEYFRAMES_PER_SECOND": "4"}):
            self.assertEqual(keyframe_count_for_seconds(6), 26)
            self.assertEqual(keyframe_count_for_seconds(10), 42)

    def test_a_raised_cap_lets_a_long_clip_past_the_default(self) -> None:
        with patch.dict(os.environ, {"VIDEO_MAX_KEYFRAMES": "128"}):
            self.assertEqual(keyframe_count_for_seconds(60), 122)
            self.assertEqual(keyframe_count_for_seconds(300), 128)

    def test_the_floor_still_applies_under_a_raised_cap(self) -> None:
        with patch.dict(os.environ, {"VIDEO_MAX_KEYFRAMES": "128"}):
            self.assertEqual(keyframe_count_for_seconds(1), VIDEO_KEYFRAME_COUNT)

    def test_a_lowered_cap_wins_over_the_floor(self) -> None:
        # The cap keeps the request tractable, so it is the last word.
        with patch.dict(os.environ, {"VIDEO_MAX_KEYFRAMES": "8"}):
            self.assertEqual(keyframe_count_for_seconds(1), 8)

    def test_a_value_that_would_send_nothing_is_ignored(self) -> None:
        # A cap of zero comes back as a caption of nothing rather than as an error.
        for raw in ("0", "-4", "", "   ", "many", "2.5"):
            with patch.dict(os.environ, {"VIDEO_MAX_KEYFRAMES": raw}):
                self.assertEqual(get_max_video_keyframes(), SETTING_DEFAULTS.video_max_keyframes)
            with patch.dict(os.environ, {"VIDEO_KEYFRAMES_PER_SECOND": raw}):
                self.assertEqual(
                    get_keyframes_per_second(), SETTING_DEFAULTS.video_keyframes_per_second
                )
            with patch.dict(os.environ, {"VIDEO_FRAME_MAX_PIXELS": raw}):
                self.assertEqual(
                    get_video_frame_max_pixels(), SETTING_DEFAULTS.video_frame_max_pixels
                )
            with patch.dict(os.environ, {"VIDEO_FRAME_MIN_PIXELS": raw}):
                self.assertEqual(
                    get_video_frame_min_pixels(), SETTING_DEFAULTS.video_frame_min_pixels
                )
            with patch.dict(os.environ, {"IMAGE_MAX_PIXELS": raw}):
                self.assertEqual(get_image_max_pixels(), SETTING_DEFAULTS.image_max_pixels)

    def test_each_media_kind_reads_its_own_configured_budget(self) -> None:
        # Neither knob may be bound at import.
        with patch.dict(
            os.environ,
            {"IMAGE_MAX_PIXELS": "900000", "VIDEO_FRAME_MAX_PIXELS": "262144"},
        ):
            self.assertEqual(media_kind_max_pixels("image"), 900_000)
            self.assertEqual(media_kind_max_pixels("video"), 262_144)

    def test_the_two_budgets_are_independent(self) -> None:
        # Setting the video knob must not drag the still one down with it.
        with patch.dict(os.environ, {"VIDEO_FRAME_MAX_PIXELS": "262144"}):
            self.assertEqual(media_kind_max_pixels("image"), SETTING_DEFAULTS.image_max_pixels)


class VideoFramePixelScaleTests(unittest.TestCase):
    """Per-frame size shrinks between 7s and 20s so a long clip still fits one request."""

    def test_a_short_clip_keeps_the_full_budget(self) -> None:
        for seconds in (None, 0.5, 7.0, VIDEO_FRAME_SCALE_START_SECONDS):
            self.assertEqual(
                video_frame_max_pixels_for_seconds(seconds), SETTING_DEFAULTS.video_frame_max_pixels
            )
            self.assertEqual(
                media_kind_max_pixels("video", seconds=seconds),
                SETTING_DEFAULTS.video_frame_max_pixels,
            )

    def test_a_twenty_second_clip_is_at_the_resize_floor(self) -> None:
        for seconds in (20.0, VIDEO_FRAME_SCALE_END_SECONDS, 21, 60, 300):
            self.assertEqual(
                video_frame_max_pixels_for_seconds(seconds), SETTING_DEFAULTS.video_frame_min_pixels
            )

    def test_the_shrink_is_gradual_between_the_ends(self) -> None:
        ten = video_frame_max_pixels_for_seconds(10)
        self.assertEqual(ten, 445_110)
        self.assertGreater(ten, SETTING_DEFAULTS.video_frame_min_pixels)
        self.assertLess(ten, SETTING_DEFAULTS.video_frame_max_pixels)
        midpoint = video_frame_max_pixels_for_seconds(13.5)
        self.assertLess(midpoint, ten)
        self.assertGreater(midpoint, SETTING_DEFAULTS.video_frame_min_pixels)
        self.assertGreater(ten, video_frame_max_pixels_for_seconds(15))

    def test_an_unusable_duration_keeps_the_full_budget(self) -> None:
        for seconds in (0, -5, float("nan"), float("inf")):
            self.assertEqual(
                video_frame_max_pixels_for_seconds(seconds), SETTING_DEFAULTS.video_frame_max_pixels
            )

    def test_a_configured_budget_is_what_a_short_clip_starts_from(self) -> None:
        with patch.dict(os.environ, {"VIDEO_FRAME_MAX_PIXELS": "400000"}):
            self.assertEqual(video_frame_max_pixels_for_seconds(7), 400_000)
            self.assertEqual(
                video_frame_max_pixels_for_seconds(20), SETTING_DEFAULTS.video_frame_min_pixels
            )
            self.assertEqual(media_kind_max_pixels("video", seconds=10), 368_187)

    def test_a_budget_already_at_the_floor_does_not_grow_for_a_long_clip(self) -> None:
        with patch.dict(os.environ, {"VIDEO_FRAME_MAX_PIXELS": "125000"}):
            self.assertEqual(video_frame_max_pixels_for_seconds(7), 125_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 125_000)

    def test_stills_ignore_the_clip_span(self) -> None:
        self.assertEqual(
            media_kind_max_pixels("image", seconds=60), SETTING_DEFAULTS.image_max_pixels
        )

    def test_a_configured_min_is_what_a_long_clip_lands_on(self) -> None:
        with patch.dict(os.environ, {"VIDEO_FRAME_MIN_PIXELS": "300000"}):
            self.assertEqual(get_video_frame_min_pixels(), 300_000)
            self.assertEqual(
                video_frame_max_pixels_for_seconds(7), SETTING_DEFAULTS.video_frame_max_pixels
            )
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 300_000)
            self.assertEqual(media_kind_max_pixels("video", seconds=10), 453_846)

    def test_a_configured_min_and_max_lerp_together(self) -> None:
        with patch.dict(
            os.environ,
            {"VIDEO_FRAME_MAX_PIXELS": "400000", "VIDEO_FRAME_MIN_PIXELS": "300000"},
        ):
            self.assertEqual(video_frame_max_pixels_for_seconds(7), 400_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 300_000)
            self.assertEqual(video_frame_max_pixels_for_seconds(10), 376_923)

    def test_a_lowered_min_lets_the_resize_go_below_five_hundred_twelve(self) -> None:
        self.assertEqual(get_qwen_min_side_px(), QWEN_MIN_SIDE_PX)
        with patch.dict(os.environ, {"VIDEO_FRAME_MIN_PIXELS": "65536"}):
            self.assertEqual(get_qwen_min_side_px(), 256)
            self.assertEqual(video_frame_max_pixels_for_seconds(20), 65_536)
            resized = resize_for_qwen(
                Image.new("RGB", (1200, 1200), color="blue"),
                max_pixels=video_frame_max_pixels_for_seconds(20),
            )
            self.assertEqual(resized.size, (256, 256))


class ResizeForQwenShapeTests(unittest.TestCase):
    """The side floor may outgrow the budget, but never by stretching one side alone."""

    def _resized(self, width: int, height: int, max_pixels: int) -> tuple[int, int]:
        return resize_for_qwen(Image.new("RGB", (width, height)), max_pixels=max_pixels).size

    def test_a_widescreen_frame_keeps_its_shape_at_the_side_floor(self) -> None:
        width, height = self._resized(1920, 1080, 512 * 512)

        self.assertEqual(height, QWEN_MIN_SIDE_PX)
        self.assertAlmostEqual(width / height, 1920 / 1080, delta=0.07)
        self.assertEqual(width % 32, 0)

    def test_a_panorama_keeps_its_shape(self) -> None:
        width, height = self._resized(4096, 512, 500_000)

        self.assertEqual((width, height), (4096, 512))

    def test_an_ordinary_downscale_stays_within_the_budget(self) -> None:
        width, height = self._resized(4000, 3000, 1_000_000)

        self.assertLessEqual(width * height, 1_000_000)
        self.assertAlmostEqual(width / height, 4 / 3, delta=0.05)
        self.assertEqual((width % 32, height % 32), (0, 0))


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
            frames = load_media_images(write_media(root, "photo.png"))
            assert isinstance(frames, MediaFrames)
            self.assertEqual(len(frames.images), 1)
            # One frame has no timeline to place it on, so the request stays unlabelled.
            self.assertIsNone(frames.timestamps)

    def test_an_unreadable_still_reports_read_error_with_a_message(self) -> None:
        # Jobs surface this message as the file's result, so a read_error without one says nothing.
        with TempMediaFolder() as root:
            broken = root / "broken.png"
            broken.write_bytes(b"not an image")

            error = load_media_images(broken)
            assert isinstance(error, MediaLoadError)
            self.assertEqual(error.status, READ_ERROR)
            self.assertTrue(error.message)

    def test_a_gif_loads_as_its_opening_frame_alone(self) -> None:
        with TempMediaFolder() as root:
            frames = load_media_images(write_gif(root, "loop.gif", frames=8))
            assert isinstance(frames, MediaFrames)
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
                frames = load_media_images(media)
        assert isinstance(frames, MediaFrames)
        self.assertEqual(len(frames.images), 1)

    def test_an_unreadable_gif_reports_read_error(self) -> None:
        # GIFs take the still path, so they land with stills rather than the frame extractor.
        with TempMediaFolder() as root:
            broken = root / "broken.gif"
            broken.write_bytes(b"not a gif")

            error = load_media_images(broken)
            assert isinstance(error, MediaLoadError)
            self.assertEqual(error.status, READ_ERROR)
            self.assertTrue(error.message)

    def test_undecodable_motion_reports_frame_error_without_a_message(self) -> None:
        # The extractor logs the reason; the user gets the count.
        with TempMediaFolder() as root:
            broken = root / "broken.mp4"
            broken.write_bytes(b"not a video")

            error = load_media_images(broken)
            assert isinstance(error, MediaLoadError)
            self.assertEqual(error.status, FRAME_ERROR)
            self.assertIsNone(error.message)


class ExtractVideoKeyframesTests(unittest.TestCase):
    def test_extract_video_keyframes_returns_none_for_minimal_mp4(self) -> None:
        try:
            import cv2  # noqa: F401
        except ImportError:
            self.skipTest("opencv-python-headless is not installed")

        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")
            extracted = extract_video_keyframes(video)

        self.assertIsNone(extracted)

    def test_extract_video_keyframes_releases_a_capture_that_never_opened(self) -> None:
        # An unreleased capture holds the .mp4 open on Windows and locks it.
        released: list[bool] = []

        class FakeCapture:
            def isOpened(self) -> bool:  # mirrors the cv2 API
                return False

            def release(self) -> None:
                released.append(True)

        fake_cv2 = type("cv2", (), {"VideoCapture": staticmethod(lambda _path: FakeCapture())})

        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")
            with patch.dict("sys.modules", {"cv2": fake_cv2}):
                extracted = extract_video_keyframes(video)

        self.assertIsNone(extracted)
        self.assertEqual(released, [True])


# The real cv2 values, so a capture that is handed the wrong one is still recognisable.
FAKE_CAP_PROP_POS_MSEC = 0
FAKE_CAP_PROP_POS_FRAMES = 1
FAKE_CAP_PROP_FPS = 5
FAKE_CAP_PROP_FRAME_COUNT = 7


class FakeCapture:
    """A capture whose frames are solid greys, so a frame's index is readable back."""

    def __init__(
        self,
        decodable: int,
        reported: int | None = None,
        *,
        fps: float = 0.0,
        width: int = 8,
        height: int = 8,
    ) -> None:
        self.decodable = decodable
        self.reported = decodable if reported is None else reported
        self.fps = fps
        self.width = width
        self.height = height
        self.position = 0
        self.released = False
        self.seeks: list[int] = []

    def isOpened(self) -> bool:
        return True

    def get(self, prop: int) -> float:
        if prop == FAKE_CAP_PROP_FPS:
            return float(self.fps)
        return float(self.reported)

    def set(self, _prop: int, value: float) -> bool:
        self.position = int(value)
        self.seeks.append(self.position)
        return True

    def read(self):
        if self.position >= self.decodable:
            return False, None
        # cvtColor is identity, so the shade is the frame index; keep it under 256 for uint8.
        frame = numpy.full((self.height, self.width, 3), self.position, dtype=numpy.uint8)
        self.position += 1
        return True, frame

    def release(self) -> None:
        self.released = True


def _fake_cv2_for(capture: FakeCapture):
    return type(
        "cv2",
        (),
        {
            "VideoCapture": staticmethod(lambda _path: capture),
            "CAP_PROP_FRAME_COUNT": FAKE_CAP_PROP_FRAME_COUNT,
            "CAP_PROP_POS_FRAMES": FAKE_CAP_PROP_POS_FRAMES,
            "CAP_PROP_FPS": FAKE_CAP_PROP_FPS,
            "CAP_PROP_POS_MSEC": FAKE_CAP_PROP_POS_MSEC,
            "COLOR_BGR2RGB": 4,
            "cvtColor": staticmethod(lambda frame, _code: frame),
        },
    )


def _shades(frames) -> list[int]:
    """The source index of every extracted frame, in order."""
    return [frame.getpixel((0, 0))[0] for frame in frames.images]


def _extract_from(capture: FakeCapture, count: int | None):
    with TempMediaFolder() as root:
        video = write_mp4_video(root, "clip.mp4")
        with patch.dict("sys.modules", {"cv2": _fake_cv2_for(capture)}):
            return extract_video_keyframes(video, count)


class VariableFrameRateTimestampTests(unittest.TestCase):
    """Frame labels are presentation times; index / average fps is wrong once the rate varies."""

    def test_labels_are_each_frames_own_time(self) -> None:
        with TempMediaFolder() as root:
            clip = root / "vfr.mp4"
            # Ten frames 0.1 s apart, then ten 0.5 s apart.
            subprocess.run(
                [
                    str(ffmpeg_path()),
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=64x48:rate=10:duration=2",
                    "-vf",
                    "setpts='if(lt(N,10),N/10,1+(N-10)*0.5)/TB'",
                    "-fps_mode",
                    "passthrough",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(clip),
                ],
                check=True,
                capture_output=True,
                timeout=30,
            )

            frames = extract_video_keyframes(clip, count=3)

        assert frames is not None and frames.timestamps is not None
        # Frames 0, 10 and 18: the last reported frame does not decode, so the walk-back finds 18.
        for label, expected in zip(frames.timestamps, (0.0, 1.0, 5.0), strict=True):
            self.assertAlmostEqual(label, expected, places=2)


class VideoKeyframeSpanTests(unittest.TestCase):
    """The clip's opening and closing frames both have to reach the model."""

    def _extract(self, capture: FakeCapture, count: int | None = VIDEO_KEYFRAME_COUNT):
        """Pins the count these cases were written around; production passes ``None``."""
        return _extract_from(capture, count)

    def test_spans_the_whole_clip(self) -> None:
        frames = self._extract(FakeCapture(decodable=120))

        assert frames is not None
        shades = _shades(frames)
        self.assertEqual(len(shades), VIDEO_KEYFRAME_COUNT)
        self.assertEqual(shades[0], 0)
        self.assertEqual(shades[-1], 119)
        self.assertEqual(shades, sorted(shades))

    def test_reaches_the_last_frame_when_the_reported_count_overshoots(self) -> None:
        # Seeking to the reported end fails; closing frames used to be dropped silently.
        frames = self._extract(FakeCapture(decodable=100, reported=112))

        assert frames is not None
        self.assertEqual(_shades(frames)[-1], 99)

    def test_gives_up_on_a_tail_that_is_broken_rather_than_mis_measured(self) -> None:
        capture = FakeCapture(decodable=40, reported=400)
        frames = self._extract(capture)

        assert frames is not None
        # No closing frame is reachable within the walk, so return what was captured.
        self.assertLessEqual(len(capture.seeks), VIDEO_KEYFRAME_COUNT + TAIL_SEEK_LIMIT)

    def test_reaches_the_last_frame_when_the_container_reports_no_count(self) -> None:
        # Reported 0 cannot be seeked; used to return opening frames only.
        frames = self._extract(FakeCapture(decodable=250, reported=0))

        assert frames is not None
        shades = _shades(frames)
        self.assertEqual(shades[0], 0)
        self.assertEqual(shades[-1], 249)
        self.assertEqual(shades, sorted(shades))
        self.assertLessEqual(len(shades), VIDEO_KEYFRAME_COUNT)

    def test_a_short_clip_yields_each_frame_once(self) -> None:
        # Padding five frames out to twelve would make the keyframe sentence claim twelve.
        frames = self._extract(FakeCapture(decodable=5))

        assert frames is not None
        self.assertEqual(_shades(frames), [0, 1, 2, 3, 4])

    def test_a_single_frame_clip_is_not_repeated(self) -> None:
        frames = self._extract(FakeCapture(decodable=1))

        assert frames is not None
        self.assertEqual(_shades(frames), [0])

    def test_an_undecodable_capture_reports_nothing(self) -> None:
        self.assertIsNone(self._extract(FakeCapture(decodable=0, reported=30)))
        self.assertIsNone(self._extract(FakeCapture(decodable=0, reported=0)))


class AdaptiveKeyframeCountTests(unittest.TestCase):
    """How many frames a clip yields when nobody names a count."""

    def _extract(self, capture: FakeCapture, count: int | None = None):
        return _extract_from(capture, count)

    def test_a_long_clip_is_sampled_by_its_length(self) -> None:
        frames = self._extract(FakeCapture(decodable=240, fps=30))

        assert frames is not None
        shades = _shades(frames)
        # Eight seconds: two a second plus both endpoints.
        self.assertEqual(len(shades), 18)
        self.assertEqual(shades[0], 0)
        self.assertEqual(shades[-1], 239)
        self.assertEqual(shades, sorted(shades))

    def test_a_short_clip_is_not_sampled_more_thinly_than_the_floor(self) -> None:
        # Two seconds is six frames; the floor keeps a brief clip from being sampled thinner than eight.
        frames = self._extract(FakeCapture(decodable=120, fps=60))

        assert frames is not None
        self.assertEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

    def test_a_very_long_clip_stops_at_the_cap_and_still_ends_on_its_last_frame(self) -> None:
        # Fifty seconds asks for 102 inlined frames; the closing frame has to survive the clamp.
        capture = FakeCapture(decodable=250, fps=5)
        frames = self._extract(capture)

        assert frames is not None
        shades = _shades(frames)
        self.assertEqual(len(shades), SETTING_DEFAULTS.video_max_keyframes)
        self.assertEqual(shades[0], 0)
        self.assertEqual(shades[-1], 249)
        self.assertEqual(len(set(shades)), len(shades))

    def test_a_named_count_is_never_overridden(self) -> None:
        frames = self._extract(FakeCapture(decodable=250, fps=5), count=VIDEO_KEYFRAME_COUNT)

        assert frames is not None
        self.assertEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

    def test_a_frame_rate_that_cannot_be_trusted_falls_back_to_the_fixed_count(self) -> None:
        # 90000 is an MPEG timescale reported as fps, which would last a fraction of a second.
        for fps in (0.0, -30.0, float("nan"), 90_000.0):
            with self.subTest(fps=fps):
                frames = self._extract(FakeCapture(decodable=240, fps=fps))

                assert frames is not None
                self.assertEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

    def test_a_derived_count_still_gives_up_on_a_broken_tail(self) -> None:
        capture = FakeCapture(decodable=40, reported=400, fps=1)
        frames = self._extract(capture)

        assert frames is not None
        self.assertLessEqual(
            len(capture.seeks), SETTING_DEFAULTS.video_max_keyframes + TAIL_SEEK_LIMIT
        )

    def test_a_clip_that_reports_no_frame_count_keeps_the_fixed_count(self) -> None:
        # Streamed decode holds frames during the pass, so this path stays on the smaller budget.
        frames = self._extract(FakeCapture(decodable=250, reported=0, fps=30))

        assert frames is not None
        self.assertLessEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

    def test_frames_carry_the_second_they_were_taken_at(self) -> None:
        # Labels come from the indices the sampler landed on, even when the tail walk moves one.
        frames = self._extract(FakeCapture(decodable=240, fps=30))

        assert frames is not None
        timestamps = frames.timestamps
        assert timestamps is not None
        self.assertEqual(len(timestamps), len(frames.images))
        self.assertEqual(timestamps[0], 0.0)
        self.assertAlmostEqual(timestamps[-1], 239 / 30)
        self.assertEqual(timestamps, sorted(timestamps))

    def test_a_clip_with_no_usable_frame_rate_carries_no_timestamps(self) -> None:
        # Do not label frames from a rate that was rejected.
        for fps in (0.0, -30.0, float("nan"), 90_000.0):
            with self.subTest(fps=fps):
                frames = self._extract(FakeCapture(decodable=240, fps=fps))

                assert frames is not None
                self.assertIsNone(frames.timestamps)

    def test_a_streamed_clip_carries_no_timestamps(self) -> None:
        # The halving stride breaks position-in-list vs position-in-clip, so any label is a guess.
        frames = self._extract(FakeCapture(decodable=250, reported=0, fps=30))

        assert frames is not None
        self.assertIsNone(frames.timestamps)

    def test_frames_come_back_within_the_multi_frame_pixel_budget(self) -> None:
        # Frames sit in memory for the whole model call, so they are capped as they are read.
        frames = self._extract(FakeCapture(decodable=3, width=1200, height=1200))

        assert frames is not None
        for frame in frames.images:
            self.assertLessEqual(
                frame.width * frame.height, SETTING_DEFAULTS.video_frame_max_pixels
            )
        # A solid frame survives the resize, so its index is still readable back.
        self.assertEqual(_shades(frames), [0, 1, 2])

    def test_a_configured_pixel_budget_reaches_the_decoded_frames(self) -> None:
        # Bound at import, frames come out at the old size. Raised because the floor swallows a lower one.
        budget = SETTING_DEFAULTS.video_frame_min_pixels * 4
        with patch.dict(os.environ, {"VIDEO_FRAME_MAX_PIXELS": str(budget)}):
            frames = self._extract(FakeCapture(decodable=3, width=4000, height=4000))

        assert frames is not None
        for frame in frames.images:
            self.assertLessEqual(frame.width * frame.height, budget)
            self.assertGreater(frame.width * frame.height, SETTING_DEFAULTS.video_frame_max_pixels)

    def test_a_budget_under_the_resize_floor_cannot_shrink_a_frame(self) -> None:
        # Below the floor the knob buys no frames; the short side holds and the shape is kept.
        with patch.dict(os.environ, {"VIDEO_FRAME_MAX_PIXELS": "125000"}):
            frames = self._extract(FakeCapture(decodable=1, width=1920, height=1080))

        assert frames is not None
        frame = frames.images[0]
        self.assertEqual(frame.size, (896, QWEN_MIN_SIDE_PX))

    def test_a_seven_second_clip_keeps_the_full_frame_budget(self) -> None:
        frames = self._extract(FakeCapture(decodable=210, fps=30, width=1200, height=1200))

        assert frames is not None
        self.assertEqual(len(frames.images), 16)
        for frame in frames.images:
            pixels = frame.width * frame.height
            self.assertLessEqual(pixels, SETTING_DEFAULTS.video_frame_max_pixels)
            self.assertGreater(pixels, SETTING_DEFAULTS.video_frame_min_pixels)

    def test_a_twenty_second_clip_shrinks_frames_to_the_resize_floor(self) -> None:
        frames = self._extract(FakeCapture(decodable=100, fps=5, width=1200, height=1200))

        assert frames is not None
        self.assertEqual(len(frames.images), SETTING_DEFAULTS.video_max_keyframes)
        for frame in frames.images:
            self.assertLessEqual(
                frame.width * frame.height, SETTING_DEFAULTS.video_frame_min_pixels
            )
            self.assertGreaterEqual(min(frame.size), QWEN_MIN_SIDE_PX)


if __name__ == "__main__":
    unittest.main()
