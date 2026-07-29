"""Unit tests for automation.auto_caption."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from PIL import Image

from automation.auto_caption import (
    VIDEO_FRAME_MAX_PIXELS,
    VIDEO_KEYFRAME_COUNT,
    build_system_prompt,
    complete_caption,
    extract_video_keyframes,
    list_auto_caption_media,
    process_media,
    run_auto_caption_job,
    validate_auto_caption_folder,
)
from automation.vision import (
    INSTRUCT_THINK_PREFILL,
    MAX_MODEL_ATTEMPTS,
    prepare_images_for_api,
    resize_for_qwen,
)
from testing_fixtures import (
    TempMediaFolder,
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
    def test_list_auto_caption_media_includes_mp4(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")

            names = [path.name for path in list_auto_caption_media(root)]

            self.assertCountEqual(names, ["clip.mp4", "photo.png"])

    def test_build_video_system_prompt_mentions_sequence(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="video")

            self.assertIn("video", prompt.lower())
            self.assertIn("chronological order", prompt.lower())
            self.assertIn(str(VIDEO_KEYFRAME_COUNT), prompt)
            self.assertIn("Focus on the subject.", prompt)

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
                _path, caption, status = process_media(
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
                _path, caption, status = process_media(
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
                _path, caption, status = process_media(
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
