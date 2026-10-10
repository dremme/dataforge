from __future__ import annotations

import base64
import json
import os
import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from PIL import Image

from automation.audio import AUDIO_MAX_SECONDS
from automation.auto_caption import (
    AUDIO_OBJECTIVE_SENTENCE,
    AUDIO_USER_SENTENCE,
    MOTION_OBJECTIVE_SENTENCE,
    build_system_prompt,
    complete_caption,
    list_auto_caption_media,
    process_media,
    run_auto_caption_job,
    validate_auto_caption_folder,
)
from automation.job_messages import auto_caption_failure_message
from automation.llm import INSTRUCT_THINK_PREFILL, MAX_MODEL_ATTEMPTS
from automation.vision import VIDEO_KEYFRAME_COUNT, MediaFrames, load_media_images
from testing_fixtures import (
    FakeChatClient,
    TempMediaFolder,
    write_gif,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)

POLISHED_CAPTION = (
    "A detailed portrait with warm sunlight falling across the subject's face "
    "and soft shadows in the background, with layered textures in the clothing, "
    "subtle color grading, reflective highlights, and rich environmental context "
    "that makes this caption substantially longer than the short draft threshold."
)

SYSTEM_PROMPTS = {"image": "system prompt", "video": "system prompt"}

FAKE_WAV = b"RIFF$\x00\x00\x00WAVEfmt fake pcm payload for the request assertions"


def _user_parts(client: FakeChatClient) -> list[dict]:
    return client.last["messages"][1]["content"]


def _part_types(client: FakeChatClient) -> list[str]:
    return [part["type"] for part in _user_parts(client)]


def _user_text(client: FakeChatClient) -> str:
    """The instruction; any text part before it is a timestamp label."""
    return [part["text"] for part in _user_parts(client) if part["type"] == "text"][-1]


def _audio_payloads(request: dict) -> list[bytes]:
    """The decoded audio of every ``input_audio`` part in one recorded request."""
    return [
        base64.b64decode(part["input_audio"]["data"])
        for part in request["messages"][1]["content"]
        if part.get("type") == "input_audio"
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
        # Without this a walking subject is captioned as standing.
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            self.assertIn(MOTION_OBJECTIVE_SENTENCE, build_system_prompt(root, media_kind="video"))
            self.assertNotIn(
                MOTION_OBJECTIVE_SENTENCE, build_system_prompt(root, media_kind="image")
            )

    def test_system_prompt_does_not_promise_a_fixed_frame_count(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="video")

        # Phrase, not the bare number: output-length guidance says "80-120 words".
        self.assertNotIn(f"{VIDEO_KEYFRAME_COUNT} keyframes", prompt)

    def test_complete_caption_sends_all_video_keyframes(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")
            frames = [
                Image.new("RGB", (320, 240), color="green") for _ in range(VIDEO_KEYFRAME_COUNT)
            ]
            client = FakeChatClient("A polished video caption.")

            caption = complete_caption(
                client, video, "Video system prompt", "Draft video caption", images=frames
            )

        self.assertEqual(caption, "A polished video caption.")
        self.assertEqual(_part_types(client).count("image_url"), VIDEO_KEYFRAME_COUNT)
        self.assertIn("chronological order", _user_text(client).lower())
        self.assertIn(str(VIDEO_KEYFRAME_COUNT), _user_text(client))

    def test_the_user_text_states_the_span_it_sampled(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            client = FakeChatClient("A polished caption.")

            complete_caption(
                client,
                media,
                "System prompt",
                "Draft",
                images=[Image.new("RGB", (64, 64)) for _ in range(2)],
                timestamps=[0.0, 239 / 30],
            )

        self.assertIn("8.0 seconds", _user_text(client))


class AutoCaptionGifTests(unittest.TestCase):
    """A GIF is captioned as a still, from its opening frame."""

    def test_the_user_text_is_the_image_prompt_with_no_frame_count(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "short.gif", frames=5)
            frames = load_media_images(media)
            assert isinstance(frames, MediaFrames)
            client = FakeChatClient("A polished GIF caption.")

            complete_caption(client, media, "System prompt", "Draft", images=frames.images)

        self.assertIn("Caption the image", _user_text(client))
        self.assertNotIn("keyframes", _user_text(client))
        # One frame and one instruction, with no timestamp labels between them.
        self.assertEqual(_part_types(client), ["image_url", "text"])

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

    def test_validate_refuses_an_empty_sysprompt(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_sysprompt(root, "  ")

            with self.assertRaisesRegex(ValueError, ".sysprompt"):
                validate_auto_caption_folder(root)

    def test_validate_accepts_a_parent_folder_sysprompt(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            child = root / "portraits"
            child.mkdir()
            write_media(child, "photo.png")

            validate_auto_caption_folder(child)

    def test_captions_with_the_parent_folder_sysprompt(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Name every animal in the frame.")
            child = root / "portraits"
            child.mkdir()

            prompt = build_system_prompt(child, media_kind="image")

        self.assertIn("Name every animal in the frame.", prompt)

    def test_validate_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")

            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_auto_caption_folder(root)


class AutoCaptionJobRunTests(unittest.TestCase):
    def test_run_job_records_api_errors(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            with patch(
                "automation.auto_caption.complete_caption",
                return_value=None,
            ) as mock_complete:
                result = run_auto_caption_job(root)

        self.assertEqual(result["stats"]["api_error"], 1)
        self.assertEqual(result["results"][0]["status"], "api_error")
        self.assertEqual(mock_complete.call_count, MAX_MODEL_ATTEMPTS)

    def test_run_job_separates_unreadable_media_from_model_failures(self) -> None:
        # A file that never decoded never reached the model; do not count it as api_error.
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

    def test_process_media_retries_until_the_caption_is_usable(self) -> None:
        for failures in ([None, None], ["too short"]):
            with (
                self.subTest(failures=failures),
                TempMediaFolder() as root,
                patch(
                    "automation.auto_caption.complete_caption",
                    side_effect=[*failures, POLISHED_CAPTION],
                ) as mock_complete,
            ):
                media = write_media(root, "photo.png")
                write_txt_caption(media, "Draft.")

                caption, status, _message, audio_missing = process_media(
                    object(), media, SYSTEM_PROMPTS
                )

                self.assertEqual(status, "success")
                self.assertEqual(caption, POLISHED_CAPTION)
                self.assertFalse(audio_missing)
                self.assertEqual(mock_complete.call_count, len(failures) + 1)

    def test_process_media_exhausts_retries_on_too_short(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.auto_caption.complete_caption",
                return_value="short",
            ) as mock_complete:
                caption, status, _message, audio_missing = process_media(
                    object(), media, SYSTEM_PROMPTS
                )

        self.assertEqual(status, "too_short")
        self.assertEqual(caption, "short")
        self.assertFalse(audio_missing)
        self.assertEqual(mock_complete.call_count, MAX_MODEL_ATTEMPTS)

    def test_a_lowered_threshold_accepts_a_caption_the_default_calls_too_short(self) -> None:
        # Output gate is read per call; bound at import, this caption is rejected until attempts run out.
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with (
                patch.dict(os.environ, {"DRAFT_CAPTION_THRESHOLD": "8"}),
                patch(
                    "automation.auto_caption.complete_caption",
                    return_value="A short caption.",
                ) as mock_complete,
            ):
                caption, status, _message, _audio_missing = process_media(
                    object(), media, SYSTEM_PROMPTS
                )

        self.assertEqual(status, "success")
        self.assertEqual(caption, "A short caption.")
        self.assertEqual(mock_complete.call_count, 1)

    def test_a_lowered_threshold_leaves_a_draft_the_default_would_complete(self) -> None:
        # Input gate reads the same knob; a low threshold skips the draft without asking the model.
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with (
                patch.dict(os.environ, {"DRAFT_CAPTION_THRESHOLD": "4"}),
                patch("automation.auto_caption.complete_caption") as mock_complete,
            ):
                caption, status, _message, _audio_missing = process_media(
                    object(), media, SYSTEM_PROMPTS
                )

        self.assertEqual(status, "skipped_long")
        self.assertIsNone(caption)
        mock_complete.assert_not_called()

    def test_run_job_trims_surrounding_whitespace_from_completed_caption(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.auto_caption.complete_caption",
                return_value=f" \n{POLISHED_CAPTION}\n\n ",
            ):
                result = run_auto_caption_job(root)

            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8"), POLISHED_CAPTION
            )

        self.assertEqual(result["stats"]["success"], 1)
        self.assertEqual(result["results"][0]["description"], POLISHED_CAPTION)

    def test_a_caption_saved_while_the_model_runs_is_kept(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            def complete(*_args, **_kwargs) -> str:
                write_txt_caption(media, "Typed by hand meanwhile.")
                return POLISHED_CAPTION

            with patch("automation.auto_caption.complete_caption", side_effect=complete):
                result = run_auto_caption_job(root)

            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8"), "Typed by hand meanwhile."
            )
        self.assertEqual(result["stats"]["caption_changed"], 1)
        self.assertEqual(result["stats"]["success"], 0)

    def test_a_file_moved_while_the_model_runs_gets_no_caption_behind(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            caption = write_txt_caption(media, "Draft.")

            def complete(*_args, **_kwargs) -> str:
                media.unlink()
                caption.unlink()
                return POLISHED_CAPTION

            with patch("automation.auto_caption.complete_caption", side_effect=complete):
                result = run_auto_caption_job(root)

            self.assertFalse(caption.exists())
        self.assertEqual(result["stats"]["caption_changed"], 1)

    def test_run_job_reads_the_txt_draft_and_leaves_leftover_json_alone(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Text draft.")
            leftover = media.with_suffix(".json")
            leftover.write_text(
                json.dumps({"description": "Leftover JSON.", "mood": "calm"}),
                encoding="utf-8",
            )

            with patch(
                "automation.auto_caption.complete_caption", return_value=POLISHED_CAPTION
            ) as mock_complete:
                result = run_auto_caption_job(root)

            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8").strip(), POLISHED_CAPTION
            )
            data = json.loads(leftover.read_text(encoding="utf-8"))

        self.assertEqual(result["stats"]["success"], 1)
        self.assertEqual(mock_complete.call_args.args[3], "Text draft.")
        self.assertEqual(data, {"description": "Leftover JSON.", "mood": "calm"})


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

        self.assertNotIn("audio", prompt.lower())

    def test_a_single_line_sysprompt_still_dedents_with_audio_on(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Focus on the subject.")

            prompt = build_system_prompt(root, media_kind="video", caption_audio=True)

        self.assertTrue(prompt.startswith("# Role"))
        self.assertNotIn("\n    ", prompt)


class AutoCaptionAudioRequestTests(unittest.TestCase):
    """What actually reaches the model when audio rides along with the keyframes."""

    def _caption(self, media, *, audio_wav: bytes | None = None, mode: str = "thinking"):
        client = FakeChatClient(POLISHED_CAPTION)
        complete_caption(
            client,
            media,
            "Video system prompt",
            "Draft.",
            images=[Image.new("RGB", (128, 128), color="blue") for _ in range(3)],
            mode=mode,
            audio_wav=audio_wav,
        )
        return client

    def test_audio_part_follows_the_frames_and_precedes_the_instruction(self) -> None:
        with TempMediaFolder() as root:
            client = self._caption(write_mp4_video(root, "clip.mp4"), audio_wav=FAKE_WAV)

        self.assertEqual(
            _part_types(client),
            ["image_url", "image_url", "image_url", "input_audio", "text"],
        )

    def test_audio_part_uses_the_exact_openai_shape(self) -> None:
        """A misspelled key is accepted and then ignored, so the caption silently lies."""
        with TempMediaFolder() as root:
            client = self._caption(write_mp4_video(root, "clip.mp4"), audio_wav=FAKE_WAV)

        [part] = [part for part in _user_parts(client) if part["type"] == "input_audio"]
        self.assertEqual(set(part), {"type", "input_audio"})
        self.assertEqual(set(part["input_audio"]), {"data", "format"})
        self.assertEqual(part["input_audio"]["format"], "wav")
        self.assertEqual(_audio_payloads(client.last), [FAKE_WAV])

    def test_no_audio_part_without_audio(self) -> None:
        with TempMediaFolder() as root:
            client = self._caption(write_mp4_video(root, "clip.mp4"))

        self.assertEqual(_part_types(client), ["image_url"] * 3 + ["text"])

    def test_user_text_claims_the_attachment_only_when_one_is_sent(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with_audio = self._caption(video, audio_wav=FAKE_WAV)
            without = self._caption(video)

        self.assertIn(AUDIO_USER_SENTENCE, _user_text(with_audio))
        self.assertIn(str(AUDIO_MAX_SECONDS), _user_text(with_audio))
        self.assertNotIn("audio", _user_text(without).lower())

    def test_a_still_never_grows_an_audio_instruction(self) -> None:
        with TempMediaFolder() as root:
            client = self._caption(write_media(root, "photo.png"), audio_wav=FAKE_WAV)

        self.assertNotIn("audio", _user_text(client).lower())

    def test_instruct_prefill_stays_the_last_message(self) -> None:
        with TempMediaFolder() as root:
            client = self._caption(
                write_mp4_video(root, "clip.mp4"), audio_wav=FAKE_WAV, mode="instruct"
            )

        messages = client.last["messages"]
        self.assertEqual([m["role"] for m in messages], ["system", "user", "assistant"])
        self.assertEqual(messages[2]["content"], INSTRUCT_THINK_PREFILL)
        self.assertEqual(_part_types(client)[-1], "text")

    def test_sampling_is_identical_with_and_without_audio(self) -> None:
        """Attaching audio must not perturb decoding; only the payload changes."""
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with_audio = self._caption(video, audio_wav=FAKE_WAV)
            without = self._caption(video)

        for knob in (
            "model",
            "max_tokens",
            "temperature",
            "top_p",
            "presence_penalty",
            "extra_body",
        ):
            with self.subTest(knob=knob):
                self.assertEqual(with_audio.last[knob], without.last[knob])


class AutoCaptionAudioJobTests(unittest.TestCase):
    """How an audio run counts what it captioned."""

    def _folder_with_clip(self, root):
        write_sysprompt(root, "Describe the scene.")
        media = write_mp4_video(root, "clip.mp4")
        write_txt_caption(media, "Draft.")
        return media

    def _patched_frames(self):
        frames = MediaFrames(images=[Image.new("RGB", (64, 64), color="blue")])
        return patch("automation.auto_caption.load_media_images", return_value=frames)

    def test_audio_is_extracted_once_and_resent_on_every_retry(self) -> None:
        with TempMediaFolder() as root:
            media = self._folder_with_clip(root)
            client = FakeChatClient("too short")

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                self._patched_frames(),
                patch(
                    "automation.auto_caption.extract_audio_wav", return_value=FAKE_WAV
                ) as extract,
            ):
                result = run_auto_caption_job(root, caption_audio=True)

        self.assertEqual(result["stats"]["too_short"], 1)
        extract.assert_called_once()
        self.assertEqual(extract.call_args.args[0], media)
        # Decoded once, sent three times: a retry must not re-read the clip.
        self.assertEqual(len(client.requests), MAX_MODEL_ATTEMPTS)
        for request in client.requests:
            self.assertEqual(_audio_payloads(request), [FAKE_WAV])

    def test_a_silent_clip_is_captioned_and_counted_without_failing_the_job(self) -> None:
        with TempMediaFolder() as root:
            media = self._folder_with_clip(root)

            with (
                patch("automation.auto_caption.complete_caption", return_value=POLISHED_CAPTION),
                self._patched_frames(),
                patch("automation.auto_caption.extract_audio_wav", return_value=None),
            ):
                result = run_auto_caption_job(root, caption_audio=True)

            caption = media.with_suffix(".txt").read_text(encoding="utf-8").strip()

        self.assertEqual(caption, POLISHED_CAPTION)
        self.assertEqual(result["stats"]["audio_error"], 1)
        self.assertEqual(result["stats"]["success"], 1)
        self.assertEqual((result["processed"], result["total"]), (1, 1))
        self.assertIsNone(auto_caption_failure_message(result["stats"]))

    def test_a_still_image_never_counts_as_missing_audio(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

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
            client = FakeChatClient(POLISHED_CAPTION)

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                self._patched_frames(),
                patch("automation.auto_caption.extract_audio_wav") as extract,
            ):
                result = run_auto_caption_job(root)

        extract.assert_not_called()
        self.assertEqual(result["stats"]["audio_error"], 0)
        self.assertNotIn("input_audio", _part_types(client))
        self.assertNotIn("audio", _user_text(client).lower())
        self.assertNotIn("audio", client.last["messages"][0]["content"].lower())

    def test_an_audio_run_sends_the_audio_prompt_and_the_part_together(self) -> None:
        with TempMediaFolder() as root:
            self._folder_with_clip(root)
            client = FakeChatClient(POLISHED_CAPTION)

            with (
                patch("automation.llm.create_openai_client", return_value=client),
                self._patched_frames(),
                patch("automation.auto_caption.extract_audio_wav", return_value=FAKE_WAV),
            ):
                result = run_auto_caption_job(root, caption_audio=True)

        self.assertEqual(result["stats"]["success"], 1)
        self.assertEqual(result["stats"]["audio_error"], 0)
        self.assertIn(AUDIO_OBJECTIVE_SENTENCE, client.last["messages"][0]["content"])
        self.assertEqual(_audio_payloads(client.last), [FAKE_WAV])

    def test_audio_captioning_requires_ffmpeg_up_front(self) -> None:
        with TempMediaFolder() as root:
            self._folder_with_clip(root)

            with patch("automation.auto_caption.ffmpeg_path", return_value=None):
                with self.assertRaises(ValueError) as caught:
                    validate_auto_caption_folder(root, caption_audio=True)

                self.assertIn("ffmpeg", str(caught.exception))
                # The same folder is fine when nothing needs ffmpeg.
                validate_auto_caption_folder(root)


if __name__ == "__main__":
    unittest.main()
