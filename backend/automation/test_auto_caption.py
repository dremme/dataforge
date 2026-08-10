"""Unit tests for automation.auto_caption."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

import numpy
from PIL import Image

from automation.auto_caption import (
    build_system_prompt,
    complete_caption,
    list_auto_caption_media,
    process_media,
    run_auto_caption_job,
    validate_auto_caption_folder,
)
from automation.vision import (
    INSTRUCT_THINK_PREFILL,
    MAX_MODEL_ATTEMPTS,
    MAX_VIDEO_KEYFRAME_COUNT,
    TAIL_SEEK_LIMIT,
    VIDEO_FRAME_MAX_PIXELS,
    VIDEO_KEYFRAME_COUNT,
    extract_keyframes,
    extract_video_keyframes,
    media_kind_for,
    prepare_images_for_api,
    resize_for_qwen,
)
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_json_caption,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)


def _make_fake_caption_client(
    response_text: str = "",
    captured: dict | None = None,
    *,
    reasoning_content: str | None = None,
) -> tuple[object, dict]:
    """Fake client + capture dict for complete_caption calls."""
    if captured is None:
        captured = {}
    message = type(
        "Message",
        (),
        {"content": response_text, "reasoning_content": reasoning_content},
    )()

    class FakeCompletions:
        def create(self, **kwargs: object) -> object:
            msgs = kwargs.get("messages")
            captured["messages"] = msgs
            captured["temperature"] = kwargs.get("temperature")
            captured["top_p"] = kwargs.get("top_p")
            captured["presence_penalty"] = kwargs.get("presence_penalty")
            captured["extra_body"] = kwargs.get("extra_body")

            if msgs and len(msgs) > 1 and isinstance(msgs[1].get("content"), list):
                parts = msgs[1]["content"]
                captured["image_count"] = sum(
                    1 for p in parts if isinstance(p, dict) and p.get("type") == "image_url"
                )
                text_part = next(
                    (p for p in parts if isinstance(p, dict) and p.get("type") == "text"),
                    None,
                )
                captured["user_text"] = text_part.get("text") if text_part else None
                captured["message_count"] = len(msgs)
            else:
                captured["message_count"] = len(msgs) if msgs else 0

            choice = type("Choice", (), {"message": message})()
            return type("Response", (), {"choices": [choice]})()

    class FakeClient:
        def __init__(self) -> None:
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    return FakeClient(), captured


class AutoCaptionVideoUnitTests(unittest.TestCase):
    def test_list_auto_caption_media_includes_mp4_and_gif(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")
            write_gif(root, "loop.gif")

            names = [path.name for path in list_auto_caption_media(root)]

            self.assertCountEqual(names, ["clip.mp4", "loop.gif", "photo.png"])

    def test_build_video_system_prompt_mentions_sequence(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="video")

            self.assertIn("video", prompt.lower())
            self.assertIn("chronological order", prompt.lower())
            self.assertIn("Focus on the subject.", prompt)

    def test_system_prompt_does_not_promise_a_fixed_frame_count(self) -> None:
        # It is built once per job, before any file is read, so it cannot know how
        # many frames a given GIF will actually yield.
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="video")

            # Matched on the phrase, not the bare number: the output-length guidance
            # says "80-120 words" and would swallow a looser assertion.
            self.assertNotIn(f"{VIDEO_KEYFRAME_COUNT} keyframes", prompt)

    def test_video_frames_use_half_megapixel_resize(self) -> None:
        image = Image.new("RGB", (1280, 720), color="red")
        image_resized = resize_for_qwen(image, max_pixels=1_000_000)
        video_resized = resize_for_qwen(image, max_pixels=VIDEO_FRAME_MAX_PIXELS)

        self.assertLess(
            video_resized.size[0] * video_resized.size[1],
            image_resized.size[0] * image_resized.size[1],
        )
        self.assertLessEqual(video_resized.size[0] * video_resized.size[1], VIDEO_FRAME_MAX_PIXELS)

    def test_prepare_images_for_api_encodes_multiple_frames(self) -> None:
        frames = [Image.new("RGB", (640, 480), color="blue") for _ in range(VIDEO_KEYFRAME_COUNT)]
        encoded = prepare_images_for_api(frames, max_pixels=VIDEO_FRAME_MAX_PIXELS)

        self.assertIsNotNone(encoded)
        assert encoded is not None
        self.assertEqual(len(encoded), VIDEO_KEYFRAME_COUNT)

    def test_complete_caption_sends_all_video_keyframes(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")
            frames = [
                Image.new("RGB", (320, 240), color="green") for _ in range(VIDEO_KEYFRAME_COUNT)
            ]

            fake_client, captured = _make_fake_caption_client("A polished video caption.")
            caption = complete_caption(
                fake_client,
                video,
                "Video system prompt",
                "Draft video caption",
                images=frames,
            )

            self.assertEqual(caption, "A polished video caption.")
            self.assertEqual(captured["image_count"], VIDEO_KEYFRAME_COUNT)
            self.assertIn("chronological order", (captured["user_text"] or "").lower())
            self.assertIn(str(VIDEO_KEYFRAME_COUNT), captured["user_text"] or "")
            self.assertEqual(captured["temperature"], 1.0)
            self.assertEqual(captured["top_p"], 0.95)
            self.assertEqual(captured["presence_penalty"], 0.0)
            self.assertEqual(captured["message_count"], 2)
            extra = captured["extra_body"]
            self.assertIsNotNone(extra)
            self.assertNotIn("chat_template_kwargs", extra)
            self.assertEqual(extra.get("top_k"), 20)
            self.assertIn("min_p", extra)

    def test_complete_caption_uses_instruct_params_when_mode_instruct(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")

            fake_client, captured = _make_fake_caption_client("Instruct style caption.")
            frames = [Image.new("RGB", (128, 128), color="blue")]
            caption = complete_caption(
                fake_client,
                media,
                "Sys prompt",
                "Draft.",
                images=frames,
                mode="instruct",
            )

            self.assertEqual(caption, "Instruct style caption.")
            self.assertEqual(captured["temperature"], 0.7)
            self.assertEqual(captured["top_p"], 0.8)
            self.assertEqual(captured["presence_penalty"], 1.5)

            msgs = captured["messages"]
            self.assertIsNotNone(msgs)
            self.assertEqual(len(msgs), 3)
            self.assertEqual(msgs[0]["role"], "system")
            self.assertEqual(msgs[1]["role"], "user")
            self.assertEqual(msgs[2]["role"], "assistant")
            self.assertEqual(msgs[2]["content"], INSTRUCT_THINK_PREFILL)

            extra = captured["extra_body"]
            self.assertIsNotNone(extra)
            self.assertEqual(extra.get("chat_template_kwargs"), {"enable_thinking": False})
            self.assertEqual(extra.get("top_k"), 20)
            self.assertIn("min_p", extra)

    def test_complete_caption_forwards_configured_repeat_penalty(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            frames = [Image.new("RGB", (128, 128), color="blue")]

            with patch.dict("os.environ", {"OPENAI_INSTRUCT_REPEAT_PENALTY": "1.2"}, clear=False):
                fake_client, captured = _make_fake_caption_client("Caption.")
                complete_caption(
                    fake_client, media, "Sys", "Draft.", images=frames, mode="instruct"
                )
                self.assertEqual(captured["extra_body"].get("repeat_penalty"), 1.2)

            # Unset again: the key must disappear rather than fall back to 1.0,
            # so servers that do not recognise it keep seeing the pre-existing request.
            fake_client, captured = _make_fake_caption_client("Caption.")
            complete_caption(fake_client, media, "Sys", "Draft.", images=frames, mode="instruct")
            self.assertNotIn("repeat_penalty", captured["extra_body"])

    def test_complete_caption_reasoning_fallback_only_in_instruct(self) -> None:
        frames = [Image.new("RGB", (128, 128), color="blue")]
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            common = {
                "media_path": media,
                "system_prompt": "Sys prompt",
                "ref_caption": "Draft.",
                "images": frames,
            }

            instruct_client, _ = _make_fake_caption_client(
                "", reasoning_content="A landscape with a mountain peak."
            )
            self.assertEqual(
                complete_caption(instruct_client, **common, mode="instruct"),
                "A landscape with a mountain peak.",
            )

            thinking_client, _ = _make_fake_caption_client(
                "", reasoning_content="Long chain of thought about the image."
            )
            self.assertIsNone(complete_caption(thinking_client, **common, mode="thinking"))

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
        # An unreleased capture holds the .mp4 open on Windows, which locks the
        # video against being moved or deleted for as long as the server runs.
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
FAKE_CAP_PROP_POS_FRAMES = 1
FAKE_CAP_PROP_FPS = 5
FAKE_CAP_PROP_FRAME_COUNT = 7


class FakeCapture:
    """A capture whose frames are solid greys, so a frame's index is readable back.

    ``reported`` is what ``CAP_PROP_FRAME_COUNT`` claims, which real containers let
    overshoot ``decodable``; ``0`` stands for the containers that report nothing and
    force the sequential read. ``fps`` defaults to the container that reports no frame
    rate at all, which is what leaves a case on the fixed keyframe count.
    """

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
        # cvtColor is patched to identity, so the shade *is* the frame index. Kept
        # under 256 by every case here, since it has to survive as one uint8.
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
            "COLOR_BGR2RGB": 4,
            "cvtColor": staticmethod(lambda frame, _code: frame),
        },
    )


def _shades(frames) -> list[int]:
    """The source index of every extracted frame, in order."""
    return [frame.getpixel((0, 0))[0] for frame in frames]


def _extract_from(capture: FakeCapture, count: int | None):
    with TempMediaFolder() as root:
        video = write_mp4_video(root, "clip.mp4")
        with patch.dict("sys.modules", {"cv2": _fake_cv2_for(capture)}):
            return extract_video_keyframes(video, count)


class VideoKeyframeSpanTests(unittest.TestCase):
    """The clip's opening and closing frames both have to reach the model.

    A caption is judged on where the motion starts and where it ends up, so a
    sample that quietly stops short of the end reads as a different clip.
    """

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
        # The regression this guards: seeking to the reported end fails, and the
        # closing frames used to be dropped without a word.
        frames = self._extract(FakeCapture(decodable=100, reported=112))

        assert frames is not None
        self.assertEqual(_shades(frames)[-1], 99)

    def test_gives_up_on_a_tail_that_is_broken_rather_than_mis_measured(self) -> None:
        capture = FakeCapture(decodable=40, reported=400)
        frames = self._extract(capture)

        assert frames is not None
        # No closing frame is reachable within the walk, so it returns what it has
        # instead of seeking backwards through the whole file.
        self.assertLessEqual(len(capture.seeks), VIDEO_KEYFRAME_COUNT + TAIL_SEEK_LIMIT)

    def test_reaches_the_last_frame_when_the_container_reports_no_count(self) -> None:
        # Reported 0 means the file cannot be seeked either, so the end is only
        # found by decoding to it. This used to return the opening frames only.
        frames = self._extract(FakeCapture(decodable=250, reported=0))

        assert frames is not None
        shades = _shades(frames)
        self.assertEqual(shades[0], 0)
        self.assertEqual(shades[-1], 249)
        self.assertEqual(shades, sorted(shades))
        self.assertLessEqual(len(shades), VIDEO_KEYFRAME_COUNT)

    def test_a_short_clip_yields_each_frame_once(self) -> None:
        # Matches the GIF path: padding five frames out to twelve would repeat
        # frames and make the keyframe sentence claim twelve of them.
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
    """How many frames a clip yields when nobody names a count.

    Twelve frames across a long clip is one sample every few seconds, so the model is
    asked to describe motion it never saw. The count follows the clip's length instead.
    """

    def _extract(self, capture: FakeCapture, count: int | None = None):
        return _extract_from(capture, count)

    def test_a_long_clip_is_sampled_by_its_length(self) -> None:
        frames = self._extract(FakeCapture(decodable=240, fps=30))

        assert frames is not None
        shades = _shades(frames)
        # Eight seconds, so two a second plus both endpoints.
        self.assertEqual(len(shades), 18)
        self.assertEqual(shades[0], 0)
        self.assertEqual(shades[-1], 239)
        self.assertEqual(shades, sorted(shades))

    def test_a_short_clip_is_not_sampled_more_thinly_than_before(self) -> None:
        # Three and a bit seconds works out at ten frames, which is fewer than this
        # clip gets today. The floor is what keeps the change from taking any away.
        frames = self._extract(FakeCapture(decodable=200, fps=60))

        assert frames is not None
        self.assertEqual(len(frames), VIDEO_KEYFRAME_COUNT)

    def test_a_very_long_clip_stops_at_the_cap_and_still_ends_on_its_last_frame(self) -> None:
        # Fifty seconds asks for 102 frames; every one would be inlined in a single
        # request. The closing frame has to survive the clamp.
        capture = FakeCapture(decodable=250, fps=5)
        frames = self._extract(capture)

        assert frames is not None
        shades = _shades(frames)
        self.assertEqual(len(shades), MAX_VIDEO_KEYFRAME_COUNT)
        self.assertEqual(shades[0], 0)
        self.assertEqual(shades[-1], 249)
        self.assertEqual(len(set(shades)), len(shades))

    def test_a_named_count_is_never_overridden(self) -> None:
        frames = self._extract(FakeCapture(decodable=250, fps=5), count=VIDEO_KEYFRAME_COUNT)

        assert frames is not None
        self.assertEqual(len(frames), VIDEO_KEYFRAME_COUNT)

    def test_a_frame_rate_that_cannot_be_trusted_falls_back_to_the_fixed_count(self) -> None:
        # 90000 is an MPEG timescale reported where the frame rate belongs, which
        # would otherwise read as a clip lasting a fraction of a second.
        for fps in (0.0, -30.0, float("nan"), 90_000.0):
            with self.subTest(fps=fps):
                frames = self._extract(FakeCapture(decodable=240, fps=fps))

                assert frames is not None
                self.assertEqual(len(frames), VIDEO_KEYFRAME_COUNT)

    def test_a_derived_count_still_gives_up_on_a_broken_tail(self) -> None:
        capture = FakeCapture(decodable=40, reported=400, fps=1)
        frames = self._extract(capture)

        assert frames is not None
        self.assertLessEqual(len(capture.seeks), MAX_VIDEO_KEYFRAME_COUNT + TAIL_SEEK_LIMIT)

    def test_a_clip_that_reports_no_frame_count_keeps_the_fixed_count(self) -> None:
        # Its length is only discoverable by decoding to the end, and the frames have
        # to be held during that decode, so this path stays on the smaller budget
        # however much the frame rate claims.
        frames = self._extract(FakeCapture(decodable=250, reported=0, fps=30))

        assert frames is not None
        self.assertLessEqual(len(frames), VIDEO_KEYFRAME_COUNT)

    def test_frames_come_back_within_the_multi_frame_pixel_budget(self) -> None:
        # Sixty-four full-resolution frames sit in memory for the whole model call,
        # retries included, so they are capped as they are read rather than later.
        frames = self._extract(FakeCapture(decodable=3, width=1200, height=1200))

        assert frames is not None
        for frame in frames:
            self.assertLessEqual(frame.width * frame.height, VIDEO_FRAME_MAX_PIXELS)
        # A solid frame survives the resize, so its index is still readable back.
        self.assertEqual(_shades(frames), [0, 1, 2])


class AutoCaptionGifTests(unittest.TestCase):
    def test_a_gif_is_captioned_as_a_video(self) -> None:
        # MediaKind is the training axis, and a GIF is a frame sequence, so it gets
        # the video prompt and the keyframe pipeline. Only rendering calls it a gif.
        with TempMediaFolder() as root:
            self.assertEqual(media_kind_for(write_gif(root, "loop.gif")), "video")
            self.assertEqual(media_kind_for(write_media(root, "photo.png")), "image")
            self.assertEqual(media_kind_for(write_mp4_video(root, "clip.mp4")), "video")

    def test_keyframes_come_from_pillow_and_never_touch_opencv(self) -> None:
        # cv2 reports a frame count of zero for many GIFs, which drops the video
        # path into its sequential fallback and captions only the opening frames.
        def explode(_path: str) -> None:
            raise AssertionError("OpenCV must not be used to read a GIF")

        fake_cv2 = type("cv2", (), {"VideoCapture": staticmethod(explode)})

        with TempMediaFolder() as root:
            # Long enough that the video path would sample it far more densely: a GIF
            # keeps the fixed count whatever its length.
            media = write_gif(root, "loop.gif", frames=120)

            with patch.dict("sys.modules", {"cv2": fake_cv2}):
                frames = extract_keyframes(media)

        assert frames is not None
        self.assertEqual(len(frames), VIDEO_KEYFRAME_COUNT)

    def test_a_short_gif_yields_one_frame_per_frame_it_has(self) -> None:
        with TempMediaFolder() as root:
            frames = extract_keyframes(write_gif(root, "short.gif", frames=5))

            assert frames is not None
            self.assertEqual(len(frames), 5)

    def test_the_user_text_states_the_real_frame_count(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "short.gif", frames=5)
            frames = extract_keyframes(media)
            assert frames is not None

            fake_client, captured = _make_fake_caption_client("A polished GIF caption.")
            complete_caption(fake_client, media, "System prompt", "Draft", images=frames)

            # Claiming 12 keyframes for a 5-frame GIF would be a plain lie to the model.
            self.assertIn("5 keyframes", captured["user_text"] or "")
            self.assertNotIn(f"{VIDEO_KEYFRAME_COUNT} keyframes", captured["user_text"] or "")

    def test_a_single_frame_gif_is_described_in_the_singular(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "still.gif", frames=1)
            frames = extract_keyframes(media)
            assert frames is not None

            fake_client, captured = _make_fake_caption_client("A polished caption.")
            complete_caption(fake_client, media, "System prompt", "Draft", images=frames)

            self.assertIn("a single frame", (captured["user_text"] or "").lower())

    def test_reading_keyframes_leaves_the_gif_movable(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif", frames=12)

            extract_keyframes(media)

            media.rename(root / "moved.gif")


class AutoCaptionFolderValidationTests(unittest.TestCase):
    def test_validate_requires_sysprompt(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaisesRegex(ValueError, ".sysprompt"):
                validate_auto_caption_folder(root)

    def test_validate_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")

            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_auto_caption_folder(root)


class AutoCaptionJobRunTests(unittest.TestCase):
    def test_run_job_records_api_errors(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.auto_caption.complete_caption",
                return_value=None,
            ) as mock_complete:
                result = run_auto_caption_job(root)

            self.assertEqual(result["stats"]["api_error"], 1)
            self.assertEqual(result["results"][0]["status"], "api_error")
            self.assertEqual(mock_complete.call_count, MAX_MODEL_ATTEMPTS)

    def test_run_job_separates_unreadable_media_from_model_failures(self) -> None:
        # A file that never decoded never reached the model, so counting it as an
        # api_error would blame the server and burn three attempts on it.
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            broken = root / "broken.png"
            broken.write_bytes(b"not an image")
            write_txt_caption(broken, "Draft.")

            with patch("automation.auto_caption.complete_caption") as mock_complete:
                result = run_auto_caption_job(root)

            self.assertEqual(result["stats"]["read_error"], 1)
            self.assertEqual(result["stats"]["api_error"], 0)
            self.assertEqual(result["results"][0]["status"], "read_error")
            self.assertTrue(result["results"][0]["message"])
            mock_complete.assert_not_called()

    def test_process_media_retries_api_errors_then_succeeds(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            polished = (
                "A detailed portrait with warm sunlight falling across the subject's face "
                "and soft shadows in the background, with layered textures in the clothing, "
                "subtle color grading, reflective highlights, and rich environmental context "
                "that makes this caption substantially longer than the short draft threshold."
            )
            self.assertGreater(len(polished), 250)

            with patch(
                "automation.auto_caption.complete_caption",
                side_effect=[None, None, polished],
            ) as mock_complete:
                _path, caption, status, _message = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "success")
            self.assertEqual(caption, polished)
            self.assertEqual(mock_complete.call_count, 3)

    def test_process_media_retries_too_short_then_succeeds(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            polished = (
                "A detailed portrait with warm sunlight falling across the subject's face "
                "and soft shadows in the background, with layered textures in the clothing, "
                "subtle color grading, reflective highlights, and rich environmental context "
                "that makes this caption substantially longer than the short draft threshold."
            )

            with patch(
                "automation.auto_caption.complete_caption",
                side_effect=["too short", polished],
            ) as mock_complete:
                _path, caption, status, _message = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "success")
            self.assertEqual(caption, polished)
            self.assertEqual(mock_complete.call_count, 2)

    def test_process_media_exhausts_retries_on_too_short(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.auto_caption.complete_caption",
                return_value="short",
            ) as mock_complete:
                _path, caption, status, _message = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "too_short")
            self.assertEqual(caption, "short")
            self.assertEqual(mock_complete.call_count, MAX_MODEL_ATTEMPTS)

    def test_run_job_writes_completed_caption(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            polished = (
                "A detailed portrait with warm sunlight falling across the subject's face "
                "and soft shadows in the background, with layered textures in the clothing, "
                "subtle color grading, reflective highlights, and rich environmental context "
                "that makes this caption substantially longer than the short draft threshold."
            )
            self.assertGreater(len(polished), 250)

            with patch("automation.auto_caption.complete_caption", return_value=polished):
                result = run_auto_caption_job(root)

            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8").strip(), polished
            )

    def test_run_job_updates_the_json_sidecar_instead_of_writing_txt(self) -> None:
        """A new .txt would be shadowed by the .json caption, so the .json is updated."""
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_json_caption(media, {"description": "Draft.", "mood": "calm"})

            polished = (
                "A detailed portrait with warm sunlight falling across the subject's face "
                "and soft shadows in the background, with layered textures in the clothing, "
                "subtle color grading, reflective highlights, and rich environmental context "
                "that makes this caption substantially longer than the short draft threshold."
            )

            with patch("automation.auto_caption.complete_caption", return_value=polished):
                result = run_auto_caption_job(root)

            self.assertEqual(result["stats"]["success"], 1)
            self.assertFalse(media.with_suffix(".txt").exists())

            data = json.loads(media.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(data["description"], polished)
            self.assertEqual(data["mood"], "calm")

    def test_run_job_reads_the_draft_from_the_json_sidecar(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Ignored text draft.")
            write_json_caption(media, {"description": "JSON draft."})

            polished = "x" * 300

            with patch(
                "automation.auto_caption.complete_caption",
                return_value=polished,
            ) as mock_complete:
                run_auto_caption_job(root)

            self.assertEqual(mock_complete.call_args.args[3], "JSON draft.")
