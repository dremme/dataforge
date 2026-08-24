"""Unit tests for automation.auto_caption."""

from __future__ import annotations

import base64
import json
import os
import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

import numpy
from PIL import Image

from automation.audio import AUDIO_MAX_SECONDS
from automation.auto_caption import (
    AUDIO_OBJECTIVE_SENTENCE,
    AUDIO_USER_SENTENCE,
    DRAFT_CAPTION_THRESHOLD_VAR,
    MOTION_OBJECTIVE_SENTENCE,
    build_system_prompt,
    complete_caption,
    list_auto_caption_media,
    process_media,
    run_auto_caption_job,
    validate_auto_caption_folder,
)
from automation.job_messages import auto_caption_failure_message
from automation.llm import (
    INSTRUCT_THINK_PREFILL,
    MAX_MODEL_ATTEMPTS,
)
from automation.vision import (
    IMAGE_MAX_PIXELS,
    MAX_VIDEO_KEYFRAME_COUNT,
    MIN_HONORED_MAX_PIXELS,
    QWEN_MIN_SIDE_PX,
    TAIL_SEEK_LIMIT,
    VIDEO_FRAME_MAX_PIXELS,
    VIDEO_FRAME_MAX_PIXELS_VAR,
    VIDEO_KEYFRAME_COUNT,
    MediaFrames,
    extract_video_keyframes,
    load_media_images,
    media_kind_for,
    media_kind_max_pixels,
    prepare_images_for_api,
    resize_for_qwen,
)
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
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
    """Fake client + capture dict for complete_caption calls.

    The whole outbound envelope is kept, not a summary of it: what the model is sent is
    the contract with the server, and a part that is subtly misshapen is accepted and
    then ignored rather than rejected. ``requests`` accumulates every call so a retrying
    test can assert what each attempt carried.
    """
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
            captured.setdefault("requests", []).append(msgs)
            captured["model"] = kwargs.get("model")
            captured["max_tokens"] = kwargs.get("max_tokens")
            captured["temperature"] = kwargs.get("temperature")
            captured["top_p"] = kwargs.get("top_p")
            captured["presence_penalty"] = kwargs.get("presence_penalty")
            captured["extra_body"] = kwargs.get("extra_body")
            captured["message_count"] = len(msgs) if msgs else 0

            if msgs and len(msgs) > 1 and isinstance(msgs[1].get("content"), list):
                parts = msgs[1]["content"]
                captured["parts"] = parts
                captured["part_types"] = [p.get("type") for p in parts if isinstance(p, dict)]
                captured["image_count"] = sum(
                    1 for p in parts if isinstance(p, dict) and p.get("type") == "image_url"
                )
                captured["audio_parts"] = [
                    p for p in parts if isinstance(p, dict) and p.get("type") == "input_audio"
                ]
                texts = [
                    p.get("text") for p in parts if isinstance(p, dict) and p.get("type") == "text"
                ]
                # The instruction is always the last part; any text before it is a
                # frame timestamp label, so taking the first would read a marker.
                captured["user_text"] = texts[-1] if texts else None
                captured["timestamp_labels"] = texts[:-1]

            choice = type("Choice", (), {"message": message})()
            return type("Response", (), {"choices": [choice]})()

    class FakeClient:
        def __init__(self) -> None:
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    return FakeClient(), captured


def _image_payloads(messages: list[dict]) -> list[str]:
    """The base64 image URLs one request carried, in order."""
    parts = messages[1]["content"]
    return [
        part["image_url"]["url"]
        for part in parts
        if isinstance(part, dict) and part.get("type") == "image_url"
    ]


def _audio_payloads(request: list[dict]) -> list[bytes]:
    """The decoded audio of every ``input_audio`` part in one captured request."""
    content = request[1]["content"]
    return [
        base64.b64decode(part["input_audio"]["data"])
        for part in content
        if isinstance(part, dict) and part.get("type") == "input_audio"
    ]


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

    def test_video_prompt_licenses_reading_motion_across_frames(self) -> None:
        # Without it the stationary reading is the only one defensible from a single
        # frame, and a walking subject gets captioned as standing.
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="video")

            self.assertIn(MOTION_OBJECTIVE_SENTENCE, prompt)

    def test_image_prompt_says_nothing_about_frames(self) -> None:
        # A still has nothing to compare against, and that prompt is separately calibrated.
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="image")

            self.assertNotIn(MOTION_OBJECTIVE_SENTENCE, prompt)

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
            self.assertEqual(
                extra.get("chat_template_kwargs"),
                {"reasoning_effort": "medium", "preserve_thinking": True},
            )
            self.assertEqual(extra.get("reasoning_effort"), "medium")
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
            self.assertNotIn("reasoning_effort", extra)
            self.assertEqual(extra.get("top_k"), 20)
            self.assertIn("min_p", extra)

    def test_complete_caption_forwards_reasoning_effort(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            frames = [Image.new("RGB", (128, 128), color="blue")]

            fake_client, captured = _make_fake_caption_client("Caption.")
            complete_caption(
                fake_client,
                media,
                "Sys",
                "Draft.",
                images=frames,
                mode="thinking",
                effort="xhigh",
                preserve_thinking=False,
            )

            extra = captured["extra_body"]
            self.assertEqual(
                extra.get("chat_template_kwargs"),
                {"reasoning_effort": "xhigh", "preserve_thinking": False},
            )
            self.assertEqual(extra.get("reasoning_effort"), "xhigh")

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
    """The source index of every extracted frame, in order.

    Takes the ``MediaFrames`` extraction returns, so a case that only cares which
    frames came back does not have to reach past the timestamps to say so.
    """
    return [frame.getpixel((0, 0))[0] for frame in frames.images]


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

    Eight frames across a long clip is one sample every few seconds, so the model is
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

    def test_a_short_clip_is_not_sampled_more_thinly_than_the_floor(self) -> None:
        # Two seconds works out at six frames, which is fewer than the floor. The
        # floor is what keeps a brief clip from being sampled more thinly than eight.
        frames = self._extract(FakeCapture(decodable=120, fps=60))

        assert frames is not None
        self.assertEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

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
        self.assertEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

    def test_a_frame_rate_that_cannot_be_trusted_falls_back_to_the_fixed_count(self) -> None:
        # 90000 is an MPEG timescale reported where the frame rate belongs, which
        # would otherwise read as a clip lasting a fraction of a second.
        for fps in (0.0, -30.0, float("nan"), 90_000.0):
            with self.subTest(fps=fps):
                frames = self._extract(FakeCapture(decodable=240, fps=fps))

                assert frames is not None
                self.assertEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

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
        self.assertLessEqual(len(frames.images), VIDEO_KEYFRAME_COUNT)

    def test_frames_carry_the_second_they_were_taken_at(self) -> None:
        # Eight seconds at 30 fps. The labels come from the frame indices the sampler
        # actually landed on, so they stay true even when the tail walk moves one.
        frames = self._extract(FakeCapture(decodable=240, fps=30))

        assert frames is not None
        timestamps = frames.timestamps
        assert timestamps is not None
        self.assertEqual(len(timestamps), len(frames.images))
        self.assertEqual(timestamps[0], 0.0)
        self.assertAlmostEqual(timestamps[-1], 239 / 30)
        self.assertEqual(timestamps, sorted(timestamps))

    def test_a_clip_with_no_usable_frame_rate_carries_no_timestamps(self) -> None:
        # The count already falls back here; labelling the frames from a rate that was
        # rejected would put times on them the sampling itself did not believe.
        for fps in (0.0, -30.0, float("nan"), 90_000.0):
            with self.subTest(fps=fps):
                frames = self._extract(FakeCapture(decodable=240, fps=fps))

                assert frames is not None
                self.assertIsNone(frames.timestamps)

    def test_a_streamed_clip_carries_no_timestamps(self) -> None:
        # The halving stride breaks the link between a survivor's position and its
        # position in the clip, so any label would be a guess.
        frames = self._extract(FakeCapture(decodable=250, reported=0, fps=30))

        assert frames is not None
        self.assertIsNone(frames.timestamps)

    def test_the_user_text_states_the_span_it_sampled(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            frames = _extract_from(FakeCapture(decodable=240, fps=30), None)
            assert frames is not None

            fake_client, captured = _make_fake_caption_client("A polished caption.")
            complete_caption(
                fake_client,
                media,
                "System prompt",
                "Draft",
                images=frames.images,
                timestamps=frames.timestamps,
            )

            self.assertIn("8.0 seconds", captured["user_text"] or "")

    def test_frames_come_back_within_the_multi_frame_pixel_budget(self) -> None:
        # Dozens of full-resolution frames sit in memory for the whole model call,
        # retries included, so they are capped as they are read rather than later.
        frames = self._extract(FakeCapture(decodable=3, width=1200, height=1200))

        assert frames is not None
        for frame in frames.images:
            self.assertLessEqual(frame.width * frame.height, VIDEO_FRAME_MAX_PIXELS)
        # A solid frame survives the resize, so its index is still readable back.
        self.assertEqual(_shades(frames), [0, 1, 2])

    def test_a_configured_pixel_budget_reaches_the_decoded_frames(self) -> None:
        # Catches the budget being resolved once at import, where the getter would read
        # back fine and every frame still come out at the old size. Raised rather than
        # lowered because the resize floor swallows a lower one - see below.
        budget = MIN_HONORED_MAX_PIXELS * 4
        with patch.dict(os.environ, {VIDEO_FRAME_MAX_PIXELS_VAR: str(budget)}):
            frames = self._extract(FakeCapture(decodable=3, width=4000, height=4000))

        assert frames is not None
        for frame in frames.images:
            self.assertLessEqual(frame.width * frame.height, budget)
            self.assertGreater(frame.width * frame.height, VIDEO_FRAME_MAX_PIXELS)

    def test_a_budget_under_the_resize_floor_cannot_shrink_a_frame(self) -> None:
        # The trap in the other direction: below the floor the knob buys no frames and
        # reshapes them instead, so a 16:9 source comes back square.
        with patch.dict(os.environ, {VIDEO_FRAME_MAX_PIXELS_VAR: "125000"}):
            frames = self._extract(FakeCapture(decodable=1, width=1920, height=1080))

        assert frames is not None
        frame = frames.images[0]
        self.assertEqual(frame.size, (QWEN_MIN_SIDE_PX, QWEN_MIN_SIDE_PX))
        self.assertEqual(frame.width * frame.height, MIN_HONORED_MAX_PIXELS)

    def test_a_configured_budget_reaches_the_request_the_same_way(self) -> None:
        # The other half of the trap: this was a module-level dict, so a set budget
        # shrank frames on read and was re-applied at the old size on the way out.
        budget = VIDEO_FRAME_MAX_PIXELS // 4
        with patch.dict(os.environ, {VIDEO_FRAME_MAX_PIXELS_VAR: str(budget)}):
            self.assertEqual(media_kind_max_pixels("video"), budget)
            self.assertEqual(media_kind_max_pixels("image"), IMAGE_MAX_PIXELS)

    def test_a_seven_second_clip_keeps_the_full_frame_budget(self) -> None:
        frames = self._extract(FakeCapture(decodable=210, fps=30, width=1200, height=1200))

        assert frames is not None
        self.assertEqual(len(frames.images), 16)
        for frame in frames.images:
            pixels = frame.width * frame.height
            self.assertLessEqual(pixels, VIDEO_FRAME_MAX_PIXELS)
            self.assertGreater(pixels, MIN_HONORED_MAX_PIXELS)

    def test_a_twenty_second_clip_shrinks_frames_to_the_resize_floor(self) -> None:
        frames = self._extract(FakeCapture(decodable=100, fps=5, width=1200, height=1200))

        assert frames is not None
        self.assertEqual(len(frames.images), MAX_VIDEO_KEYFRAME_COUNT)
        for frame in frames.images:
            self.assertLessEqual(frame.width * frame.height, MIN_HONORED_MAX_PIXELS)
            self.assertGreaterEqual(min(frame.size), QWEN_MIN_SIDE_PX)


class AutoCaptionGifTests(unittest.TestCase):
    """A GIF is captioned as a still, from its opening frame.

    The gallery still treats it as motion - it animates and its frames are still
    scrubbable - so these cases pin the captioning axis alone.
    """

    def test_a_gif_is_captioned_as_an_image(self) -> None:
        with TempMediaFolder() as root:
            self.assertEqual(media_kind_for(write_gif(root, "loop.gif")), "image")
            self.assertEqual(media_kind_for(write_media(root, "photo.png")), "image")
            self.assertEqual(media_kind_for(write_mp4_video(root, "clip.mp4")), "video")

    def test_a_long_gif_still_sends_one_frame(self) -> None:
        with TempMediaFolder() as root:
            frames, error = load_media_images(write_gif(root, "loop.gif", frames=120))

            self.assertIsNone(error)
            assert frames is not None
            self.assertEqual(len(frames.images), 1)

    def test_the_user_text_is_the_image_prompt_with_no_frame_count(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "short.gif", frames=5)
            frames, _error = load_media_images(media)
            assert frames is not None

            fake_client, captured = _make_fake_caption_client("A polished GIF caption.")
            complete_caption(fake_client, media, "System prompt", "Draft", images=frames.images)

            user_text = captured["user_text"] or ""
            self.assertIn("Caption the image", user_text)
            self.assertNotIn("keyframes", user_text)
            self.assertEqual(captured["image_count"], 1)
            self.assertEqual(captured["timestamp_labels"], [])

    def test_reading_the_first_frame_leaves_the_gif_movable(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif", frames=12)

            load_media_images(media)

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
                _path, caption, status, _message, audio_missing = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "success")
            self.assertEqual(caption, polished)
            self.assertFalse(audio_missing)
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
                _path, caption, status, _message, audio_missing = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "success")
            self.assertEqual(caption, polished)
            self.assertFalse(audio_missing)
            self.assertEqual(mock_complete.call_count, 2)

    def test_process_media_exhausts_retries_on_too_short(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.auto_caption.complete_caption",
                return_value="short",
            ) as mock_complete:
                _path, caption, status, _message, audio_missing = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "too_short")
            self.assertEqual(caption, "short")
            self.assertFalse(audio_missing)
            self.assertEqual(mock_complete.call_count, MAX_MODEL_ATTEMPTS)

    def test_a_lowered_threshold_accepts_a_caption_the_default_calls_too_short(self) -> None:
        # The output gate, read per call: bound at import instead, this caption is
        # rejected and retried until the attempts run out.
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with (
                patch.dict(os.environ, {DRAFT_CAPTION_THRESHOLD_VAR: "8"}),
                patch(
                    "automation.auto_caption.complete_caption",
                    return_value="A short caption.",
                ) as mock_complete,
            ):
                _path, caption, status, _message, _audio_missing = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "success")
            self.assertEqual(caption, "A short caption.")
            self.assertEqual(mock_complete.call_count, 1)

    def test_a_lowered_threshold_leaves_a_draft_the_default_would_complete(self) -> None:
        # The input gate reads the same knob, so a threshold low enough to make the
        # draft look finished skips the file without asking the model at all.
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with (
                patch.dict(os.environ, {DRAFT_CAPTION_THRESHOLD_VAR: "4"}),
                patch("automation.auto_caption.complete_caption") as mock_complete,
            ):
                _path, caption, status, _message, _audio_missing = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "system prompt"},
                )

            self.assertEqual(status, "skipped_long")
            self.assertIsNone(caption)
            mock_complete.assert_not_called()

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

    def test_run_job_writes_txt_and_leaves_leftover_json_alone(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")
            leftover = media.with_suffix(".json")
            leftover.write_text(
                json.dumps({"description": "Leftover JSON.", "mood": "calm"}),
                encoding="utf-8",
            )

            polished = (
                "A detailed portrait with warm sunlight falling across the subject's face "
                "and soft shadows in the background, with layered textures in the clothing, "
                "subtle color grading, reflective highlights, and rich environmental context "
                "that makes this caption substantially longer than the short draft threshold."
            )

            with patch("automation.auto_caption.complete_caption", return_value=polished):
                result = run_auto_caption_job(root)

            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8").strip(), polished
            )
            data = json.loads(leftover.read_text(encoding="utf-8"))
            self.assertEqual(data["description"], "Leftover JSON.")
            self.assertEqual(data["mood"], "calm")

    def test_run_job_reads_the_draft_from_the_txt_sidecar(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Text draft.")
            media.with_suffix(".json").write_text(
                json.dumps({"description": "JSON draft."}),
                encoding="utf-8",
            )

            polished = "x" * 300

            with patch(
                "automation.auto_caption.complete_caption",
                return_value=polished,
            ) as mock_complete:
                run_auto_caption_job(root)

            self.assertEqual(mock_complete.call_args.args[3], "Text draft.")


POLISHED_CAPTION = (
    "A detailed portrait with warm sunlight falling across the subject's face "
    "and soft shadows in the background, with layered textures in the clothing, "
    "subtle color grading, reflective highlights, and rich environmental context "
    "that makes this caption substantially longer than the short draft threshold."
)

FAKE_WAV = b"RIFF$\x00\x00\x00WAVEfmt fake pcm payload for the request assertions"


class AutoCaptionAudioPromptTests(unittest.TestCase):
    """What the prompts say once audio captioning is on."""

    def test_video_prompt_asks_about_audio_only_when_enabled(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            without = build_system_prompt(root, media_kind="video")
            with_audio = build_system_prompt(root, media_kind="video", caption_audio=True)

            self.assertNotIn(AUDIO_OBJECTIVE_SENTENCE, without)
            self.assertIn(AUDIO_OBJECTIVE_SENTENCE, with_audio)
            # The rest of a calibrated prompt must be untouched by the option.
            self.assertEqual(with_audio.replace(f" {AUDIO_OBJECTIVE_SENTENCE}", ""), without)

    def test_image_prompt_never_mentions_audio(self) -> None:
        """A still has no track, so asking about one only invites invention."""
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="image", caption_audio=True)

            self.assertNotIn(AUDIO_OBJECTIVE_SENTENCE, prompt)
            self.assertNotIn("audio", prompt.lower())

    def test_a_single_line_sysprompt_still_dedents_with_audio_on(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="video", caption_audio=True)

            self.assertTrue(prompt.startswith("# Role"))
            self.assertNotIn("\n    ", prompt)


class AutoCaptionAudioRequestTests(unittest.TestCase):
    """What actually reaches the model when audio rides along with the keyframes."""

    def setUp(self) -> None:
        self.frames = [Image.new("RGB", (128, 128), color="blue") for _ in range(3)]

    def _caption(
        self,
        media,
        *,
        audio_wav: bytes | None = None,
        mode: str = "thinking",
    ) -> tuple[str | None, dict]:
        client, captured = _make_fake_caption_client(POLISHED_CAPTION)
        caption = complete_caption(
            client,
            media,
            "Video system prompt",
            "Draft.",
            images=self.frames,
            mode=mode,
            audio_wav=audio_wav,
        )
        return caption, captured

    def test_audio_part_follows_the_frames_and_precedes_the_instruction(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            _caption, captured = self._caption(video, audio_wav=FAKE_WAV)

            self.assertEqual(
                captured["part_types"],
                ["image_url", "image_url", "image_url", "input_audio", "text"],
            )

    def test_audio_part_uses_the_exact_openai_shape(self) -> None:
        """A misspelled key is accepted and then ignored, so the caption silently lies."""
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            _caption, captured = self._caption(video, audio_wav=FAKE_WAV)

            self.assertEqual(len(captured["audio_parts"]), 1)
            part = captured["audio_parts"][0]
            self.assertEqual(set(part), {"type", "input_audio"})
            self.assertEqual(part["type"], "input_audio")
            self.assertEqual(set(part["input_audio"]), {"data", "format"})
            self.assertEqual(part["input_audio"]["format"], "wav")
            self.assertIsInstance(part["input_audio"]["data"], str)

    def test_audio_payload_round_trips_the_extracted_bytes(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            _caption, captured = self._caption(video, audio_wav=FAKE_WAV)

            self.assertEqual(_audio_payloads(captured["requests"][0]), [FAKE_WAV])

    def test_no_audio_part_without_audio(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            _caption, captured = self._caption(video)

            self.assertEqual(captured["audio_parts"], [])
            self.assertEqual(captured["part_types"], ["image_url"] * 3 + ["text"])

    def test_user_text_claims_the_attachment_only_when_one_is_sent(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            _caption, with_audio = self._caption(video, audio_wav=FAKE_WAV)
            _caption, without = self._caption(video)

            self.assertIn(AUDIO_USER_SENTENCE, with_audio["user_text"])
            self.assertIn(str(AUDIO_MAX_SECONDS), with_audio["user_text"])
            self.assertNotIn("audio", (without["user_text"] or "").lower())

    def test_a_still_never_grows_an_audio_instruction(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")

            _caption, captured = self._caption(media, audio_wav=FAKE_WAV)

            self.assertNotIn("audio", (captured["user_text"] or "").lower())

    def test_instruct_prefill_stays_the_last_message(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            _caption, captured = self._caption(video, audio_wav=FAKE_WAV, mode="instruct")

            msgs = captured["messages"]
            self.assertEqual([m["role"] for m in msgs], ["system", "user", "assistant"])
            self.assertEqual(msgs[2]["content"], INSTRUCT_THINK_PREFILL)
            self.assertEqual(captured["part_types"][-1], "text")

    def test_sampling_is_identical_with_and_without_audio(self) -> None:
        """Attaching audio must not perturb decoding; only the payload changes."""
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            _caption, with_audio = self._caption(video, audio_wav=FAKE_WAV)
            _caption, without = self._caption(video)

            for knob in (
                "model",
                "max_tokens",
                "temperature",
                "top_p",
                "presence_penalty",
                "extra_body",
            ):
                with self.subTest(knob=knob):
                    self.assertEqual(with_audio[knob], without[knob])


class AutoCaptionAudioJobTests(unittest.TestCase):
    """How an audio run counts what it captioned.

    An MP4 stands in for the media throughout. A GIF used to, back when it counted as
    motion; it is captioned as a still now and never reaches the audio path at all -
    ``test_a_still_image_never_counts_as_missing_audio`` is the shape it takes today.
    Fixture MP4s are not reliably decodable, so the frames are patched in and only
    the audio plumbing is exercised.
    """

    def _folder_with_clip(self, root):
        write_sysprompt(root, "Describe the scene.")
        media = write_mp4_video(root, "clip.mp4")
        write_txt_caption(media, "Draft.")
        return media

    def _patched_frames(self):
        frames = MediaFrames(images=[Image.new("RGB", (64, 64), color="blue")])
        return patch("automation.auto_caption.load_media_images", return_value=(frames, None))

    def test_audio_is_extracted_once_and_resent_on_every_retry(self) -> None:
        with TempMediaFolder() as root:
            media = self._folder_with_clip(root)
            client, captured = _make_fake_caption_client("too short")

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                self._patched_frames(),
                patch(
                    "automation.auto_caption.extract_audio_wav", return_value=FAKE_WAV
                ) as extract,
            ):
                result = run_auto_caption_job(root, caption_audio=True)

            self.assertEqual(result["stats"]["too_short"], 1)
            self.assertEqual(extract.call_count, 1)
            self.assertEqual(extract.call_args.args[0], media)
            # Decoded once, sent three times: a retry must not re-read the clip.
            self.assertEqual(len(captured["requests"]), MAX_MODEL_ATTEMPTS)
            for request in captured["requests"]:
                self.assertEqual(_audio_payloads(request), [FAKE_WAV])

    def test_a_retry_re_encodes_the_frames_the_failed_attempt_sent(self) -> None:
        # WORKAROUND coverage: the server short-circuits a byte-identical repeat of a
        # multimodal request, so all three attempts have to carry distinct payloads or
        # only the first one is a real attempt.
        with TempMediaFolder() as root:
            self._folder_with_clip(root)
            client, captured = _make_fake_caption_client("too short")

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                self._patched_frames(),
            ):
                run_auto_caption_job(root)

            self.assertEqual(len(captured["requests"]), MAX_MODEL_ATTEMPTS)
            sent = [_image_payloads(request) for request in captured["requests"]]
            self.assertEqual(len({tuple(images) for images in sent}), MAX_MODEL_ATTEMPTS)
            # Same frames throughout - it is the encoding that differs, not the clip.
            self.assertEqual({len(images) for images in sent}, {1})

    def test_a_silent_clip_is_still_captioned_and_counted(self) -> None:
        with TempMediaFolder() as root:
            media = self._folder_with_clip(root)

            with (
                patch("automation.auto_caption.complete_caption", return_value=POLISHED_CAPTION),
                self._patched_frames(),
                patch("automation.auto_caption.extract_audio_wav", return_value=None),
            ):
                result = run_auto_caption_job(root, caption_audio=True)

            self.assertEqual(result["stats"]["audio_error"], 1)
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8").strip(),
                POLISHED_CAPTION,
            )

    def test_missing_audio_does_not_fail_the_job_or_inflate_progress(self) -> None:
        with TempMediaFolder() as root:
            self._folder_with_clip(root)

            with (
                patch("automation.auto_caption.complete_caption", return_value=POLISHED_CAPTION),
                self._patched_frames(),
                patch("automation.auto_caption.extract_audio_wav", return_value=None),
            ):
                result = run_auto_caption_job(root, caption_audio=True)

            self.assertEqual(result["processed"], 1)
            self.assertEqual(result["total"], 1)
            self.assertIsNone(auto_caption_failure_message(result["stats"]))

    def test_a_still_image_never_counts_as_missing_audio(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with (
                patch("automation.auto_caption.complete_caption", return_value=POLISHED_CAPTION),
                patch("automation.auto_caption.extract_audio_wav") as extract,
            ):
                result = run_auto_caption_job(root, caption_audio=True)

            extract.assert_not_called()
            self.assertEqual(result["stats"]["audio_error"], 0)
            self.assertEqual(result["stats"]["success"], 1)

    def test_audio_off_never_looks_for_audio(self) -> None:
        with TempMediaFolder() as root:
            self._folder_with_clip(root)
            client, captured = _make_fake_caption_client(POLISHED_CAPTION)

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                self._patched_frames(),
                patch("automation.auto_caption.extract_audio_wav") as extract,
            ):
                result = run_auto_caption_job(root)

            extract.assert_not_called()
            self.assertEqual(result["stats"]["audio_error"], 0)
            self.assertEqual(captured["audio_parts"], [])
            self.assertNotIn("audio", (captured["user_text"] or "").lower())
            self.assertNotIn("audio", captured["messages"][0]["content"].lower())

    def test_an_audio_run_sends_the_audio_prompt_and_the_part_together(self) -> None:
        with TempMediaFolder() as root:
            self._folder_with_clip(root)
            client, captured = _make_fake_caption_client(POLISHED_CAPTION)

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                self._patched_frames(),
                patch("automation.auto_caption.extract_audio_wav", return_value=FAKE_WAV),
            ):
                result = run_auto_caption_job(root, caption_audio=True)

            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["stats"]["audio_error"], 0)
            self.assertIn(AUDIO_OBJECTIVE_SENTENCE, captured["messages"][0]["content"])
            self.assertEqual(_audio_payloads(captured["requests"][0]), [FAKE_WAV])

    def test_audio_captioning_requires_ffmpeg_up_front(self) -> None:
        with TempMediaFolder() as root:
            self._folder_with_clip(root)

            with patch("automation.auto_caption.ffmpeg_path", return_value=None):
                with self.assertRaises(ValueError) as caught:
                    validate_auto_caption_folder(root, caption_audio=True)

                self.assertIn("ffmpeg", str(caught.exception))
                # The same folder is fine when nothing needs ffmpeg.
                validate_auto_caption_folder(root)
