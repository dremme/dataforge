from __future__ import annotations

import base64
import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from PIL import Image

from automation.llm import (
    INSTRUCT_THINK_PREFILL,
    MAX_MODEL_ATTEMPTS,
)
from automation.verify_captions import (
    VerificationResult,
    _response_preview,
    build_verification_system_prompt,
    build_verification_user_text,
    list_verify_captions_media,
    parse_verification_response,
    process_media,
    run_verify_captions_job,
    should_write_issue_file,
    split_fix_sentences,
    validate_verify_captions_folder,
    verify_caption,
)
from automation.vision import (
    FRAME_ERROR,
    IMAGE_MAX_PIXELS,
    IMAGE_MAX_PIXELS_VAR,
    VIDEO_KEYFRAME_COUNT,
    MediaFrames,
    MediaLoadError,
    load_media_images,
    media_kind_for,
)
from captions import issue_file_path, load_issue_summary
from constants import MAX_ISSUE_FIXES
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_media,
    write_mp4_video,
    write_txt_caption,
)

DEFAULT_FIX = 'Replace "a blue lake" with "a snow-covered mountain peak".'


def _rules_section(prompt: str) -> str:
    return prompt[prompt.index("# Rules") : prompt.index("# Output Format")]


def _fixes_json(*fixes: str, correct: bool | None = None) -> str:
    """Build a model response: fixes become the sentences of the ``issues`` prose."""
    verdict = not fixes if correct is None else correct
    return json.dumps({"correct": verdict, "issues": " ".join(fixes) if fixes else "None"})


def _make_fake_verify_client(
    captured: dict | None = None,
    *,
    content: str | None = None,
    reasoning_content: str | None = None,
) -> tuple[object, dict]:
    """Fake OpenAI client that records call kwargs for verify_caption tests."""
    if captured is None:
        captured = {}
    if content is None and reasoning_content is None:
        content = _fixes_json(DEFAULT_FIX)
    message = type(
        "Message",
        (),
        {
            "content": "" if content is None else content,
            "reasoning_content": reasoning_content,
        },
    )()

    class FakeCompletions:
        def create(self, **kwargs: object) -> object:
            captured.update(
                {
                    "temperature": kwargs.get("temperature"),
                    "top_p": kwargs.get("top_p"),
                    "presence_penalty": kwargs.get("presence_penalty"),
                    "messages": kwargs.get("messages"),
                    "extra_body": kwargs.get("extra_body"),
                }
            )
            # Every call, not just the last: a retrying test asserts what each carried.
            captured.setdefault("requests", []).append(kwargs.get("messages"))
            choice = type("Choice", (), {"message": message})()
            return type("Response", (), {"choices": [choice]})()

    class FakeClient:
        def __init__(self) -> None:
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    return FakeClient(), captured


class VerifyCaptionsParsingTests(unittest.TestCase):
    def test_parse_valid_json_response(self) -> None:
        parsed = parse_verification_response(_fixes_json(DEFAULT_FIX))

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, (DEFAULT_FIX,))

    def test_parse_strips_markdown_fences_and_thinking_tags(self) -> None:
        raw = "<think>\nmaybe wrong\n</think>\n```json\n" + _fixes_json(DEFAULT_FIX) + "\n```"

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, (DEFAULT_FIX,))

    def test_parse_normalizes_typographic_quotes_into_one_fix(self) -> None:
        """Curly quotes leave the splitter blind to the span, fragmenting one finding in two."""
        raw = json.dumps(
            {
                "correct": False,
                "issues": "Replace “a blue car. parked outside” with “a red car”.",
            }
        )

        parsed = parse_verification_response(raw)

        assert parsed is not None
        self.assertEqual(
            parsed.fixes,
            ('Replace "a blue car. parked outside" with "a red car".',),
        )

    def test_parse_rejects_invalid_json(self) -> None:
        self.assertIsNone(parse_verification_response("not json"))

    def test_parse_rejects_payload_without_a_verdict(self) -> None:
        """An unverdicted response is retried rather than trusted."""
        self.assertIsNone(parse_verification_response(json.dumps({"issues": DEFAULT_FIX})))
        self.assertIsNone(parse_verification_response(json.dumps({"correct": "maybe"})))

    def test_parse_rejects_non_string_issues(self) -> None:
        raw = json.dumps({"correct": False, "issues": [DEFAULT_FIX]})

        self.assertIsNone(parse_verification_response(raw))

    def test_parse_coerces_a_string_verdict(self) -> None:
        raw = json.dumps({"correct": "no", "issues": DEFAULT_FIX})

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, (DEFAULT_FIX,))

    def test_parse_extracts_json_embedded_in_prose(self) -> None:
        parsed = parse_verification_response("Here is my evaluation:\n" + _fixes_json(DEFAULT_FIX))

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, (DEFAULT_FIX,))

    def test_parse_reads_a_true_verdict_as_a_matching_caption(self) -> None:
        parsed = parse_verification_response(_fixes_json())

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, ())

    def test_a_true_verdict_outranks_any_issues_that_follow_it(self) -> None:
        """Contradictions resolve toward "no issue" - the direction that avoids false flags."""
        parsed = parse_verification_response(_fixes_json(DEFAULT_FIX, correct=True))

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, ())

    def test_a_false_verdict_with_sentinel_issues_reads_as_a_match(self) -> None:
        raw = json.dumps({"correct": False, "issues": "None"})

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, ())

    def test_parse_splits_issue_prose_into_separate_fixes(self) -> None:
        raw = json.dumps({"correct": False, "issues": f'{DEFAULT_FIX} Remove "at dusk".'})

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, (DEFAULT_FIX, 'Remove "at dusk".'))

    def test_parse_keeps_only_the_three_most_important_fixes(self) -> None:
        raw = json.dumps({"correct": False, "issues": "First. Second. Third. Fourth. Fifth."})

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fixes, ("First.", "Second.", "Third."))

    def test_should_write_issue_only_when_fixes_remain(self) -> None:
        self.assertTrue(should_write_issue_file(VerificationResult(fixes=(DEFAULT_FIX,))))
        self.assertFalse(should_write_issue_file(VerificationResult(fixes=())))

    def test_a_false_verdict_without_fixes_writes_nothing(self) -> None:
        parsed = parse_verification_response(_fixes_json(correct=False))

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertFalse(should_write_issue_file(parsed))


class ResponsePreviewTests(unittest.TestCase):
    def test_a_short_response_is_returned_whole(self) -> None:
        self.assertEqual(_response_preview("Not JSON at all."), "Not JSON at all.")

    def test_whitespace_is_collapsed(self) -> None:
        self.assertEqual(_response_preview("two\n\nlines  here"), "two lines here")

    def test_a_long_response_is_cut_to_the_limit(self) -> None:
        preview = _response_preview("a" * 400, limit=40)

        self.assertEqual(len(preview), 40)
        self.assertTrue(preview.endswith("…"))

    def test_the_cut_matches_how_the_frontend_elides(self) -> None:
        """This message reaches the browser, where CSS and captionDiff both elide with U+2026."""
        self.assertNotIn("...", _response_preview("a" * 400, limit=40))


class SplitFixSentencesTests(unittest.TestCase):
    def test_splits_on_sentence_terminators(self) -> None:
        self.assertEqual(
            split_fix_sentences("Change the hair colour. Remove the scarf! Is it dusk?"),
            ["Change the hair colour.", "Remove the scarf!", "Is it dusk?"],
        )

    def test_a_terminator_inside_quotes_never_splits(self) -> None:
        """The model quotes caption phrases verbatim, punctuation included."""
        text = 'Replace "a blue car. parked outside" with "a red car".'

        self.assertEqual(split_fix_sentences(text), [text])

    def test_decimals_stay_intact(self) -> None:
        text = "Change the height to 5.5 metres."

        self.assertEqual(split_fix_sentences(text), [text])

    def test_an_ellipsis_keeps_one_finding_together(self) -> None:
        """Qwen shortens sentences with an ellipsis, which is not a sentence end."""
        text = "The caption says the arm is raised... it hangs at the side in the image."

        self.assertEqual(split_fix_sentences(text), [text])

    def test_a_sentence_after_an_ellipsis_still_splits(self) -> None:
        self.assertEqual(
            split_fix_sentences("The arm is raised... not lowered. Remove the scarf."),
            ["The arm is raised... not lowered.", "Remove the scarf."],
        )

    def test_a_trailing_ellipsis_ends_the_prose(self) -> None:
        text = "The caption trails off here..."

        self.assertEqual(split_fix_sentences(text), [text])

    def test_a_semicolon_keeps_one_finding_together(self) -> None:
        """Qwen joins the observation and its correction with a semicolon."""
        text = "The caption says the hair is blonde; it is brown in the image"

        self.assertEqual(split_fix_sentences(text), [text])

    def test_enumeration_markers_are_stripped(self) -> None:
        self.assertEqual(
            split_fix_sentences("1. Change the hair colour. 2) Remove the scarf."),
            ["Change the hair colour.", "Remove the scarf."],
        )
        self.assertEqual(
            split_fix_sentences("- Change the hair colour. * Remove the scarf."),
            ["Change the hair colour.", "Remove the scarf."],
        )

    def test_a_single_unterminated_sentence_passes_through(self) -> None:
        self.assertEqual(
            split_fix_sentences("  Change the hair colour  "), ["Change the hair colour"]
        )

    def test_blank_prose_yields_nothing(self) -> None:
        self.assertEqual(split_fix_sentences("   "), [])


class VerifyCaptionsPromptTests(unittest.TestCase):
    def test_build_system_prompt_emphasizes_hand_and_leg_positioning(self) -> None:
        prompt = build_verification_system_prompt()

        self.assertIn("hand and leg positioning", prompt.lower())

    def test_build_system_prompt_inserts_optional_context_between_objective_and_rules(
        self,
    ) -> None:
        prompt = build_verification_system_prompt("Subjects are usually seated outdoors.")

        self.assertIn("# Additional context", prompt)
        self.assertIn("Subjects are usually seated outdoors.", prompt)
        objective_pos = prompt.index("# Objective")
        context_pos = prompt.index("# Additional context")
        rules_pos = prompt.index("# Rules")
        self.assertLess(objective_pos, context_pos)
        self.assertLess(context_pos, rules_pos)

    def test_build_system_prompt_omits_context_section_when_empty(self) -> None:
        prompt = build_verification_system_prompt("   ")

        self.assertNotIn("# Additional context", prompt)

    def test_build_system_prompt_asks_for_a_verdict_and_issue_prose(self) -> None:
        """An array invites enumeration; the issues field must stay prose."""
        prompt = build_verification_system_prompt()

        self.assertIn('"correct": true or false', prompt)
        self.assertIn('"issues": "Up to', prompt)
        for retired_key in ('"fixes"', '"corrections"', '"suggestions"'):
            self.assertNotIn(retired_key, prompt)
        self.assertNotIn("confidence", prompt.lower())
        self.assertNotIn("severity", prompt.lower())

    def test_build_system_prompt_keeps_the_issue_wording_declarative(self) -> None:
        """Terse imperatives are cheap to enumerate: 2.3 findings per caption against 1.3."""
        prompt = build_verification_system_prompt()

        self.assertNotIn("Replace, Remove, or Change", prompt)
        self.assertIn("stating what it should say instead", prompt)

    def test_build_system_prompt_leads_with_permission_to_pass(self) -> None:
        """Leading with the negative case is what made the model flag every caption."""
        rules = _rules_section(build_verification_system_prompt())

        self.assertLess(rules.index('Set "correct" to true'), rules.index('Set "correct" to false'))
        self.assertIn("When you are unsure", rules)

    def test_build_system_prompt_carries_no_sample_fix_text(self) -> None:
        """A concrete example gets copied; the schema describes the shape instead."""
        prompt = build_verification_system_prompt()

        self.assertNotIn("hands on her hips", prompt)
        self.assertNotIn("left hand resting on the railing", prompt)

    def test_build_system_prompt_states_the_fix_cap(self) -> None:
        prompt = build_verification_system_prompt()

        self.assertIn(f"Up to {MAX_ISSUE_FIXES} sentences", prompt)
        self.assertIn("most important first", prompt)

    def test_build_system_prompt_confines_an_issue_to_one_sentence(self) -> None:
        """The parser splits on terminators, so a second sentence becomes a second fix."""
        prompt = build_verification_system_prompt()

        self.assertIn("Each issue is a single sentence", prompt)
        self.assertNotIn("single sentence", _rules_section(prompt))

    def test_build_system_prompt_requires_separate_issues_to_be_full_sentences(self) -> None:
        prompt = build_verification_system_prompt()

        self.assertIn("**Never** separate issues with a semicolon", prompt)
        self.assertNotIn("joined\n            with a comma or a semicolon", prompt)

    def test_build_system_prompt_places_the_separator_after_the_closing_quote(self) -> None:
        prompt = build_verification_system_prompt()

        self.assertIn('closing quote, as in `"wrong wording",`', prompt)
        self.assertIn('**never** inside it as in `"wrong wording,"`', prompt)

    def test_build_system_prompt_keeps_the_rules_about_judging(self) -> None:
        """Rules that teach fix-writing shift the prompt's weight from judging to producing."""
        rules = _rules_section(build_verification_system_prompt())

        self.assertEqual(rules.count("\n- "), 4)
        for mechanic in ("most important first", "sentences", "quote"):
            self.assertNotIn(mechanic, rules)

    def test_build_system_prompt_demands_straight_double_quotes_around_the_wording(self) -> None:
        """The splitter and the resolver's caption highlight both key off the `"` character."""
        prompt = build_verification_system_prompt()

        self.assertIn("straight double quotes", prompt)
        self.assertIn("copied character-for-character", prompt)
        self.assertNotIn("straight double quotes", _rules_section(prompt))

    def test_build_system_prompt_exempts_findings_with_nothing_to_quote(self) -> None:
        """An invented quote matches no caption text and points the resolver at nothing."""
        prompt = build_verification_system_prompt()

        self.assertIn("no wrong wording to quote", prompt)
        self.assertIn("no quotation marks at all", prompt)
        self.assertIn("**never** invented", prompt)

    def test_video_system_prompt_describes_keyframes(self) -> None:
        prompt = build_verification_system_prompt(media_kind="video")

        self.assertIn("keyframes", prompt.lower())
        self.assertIn("chronological", prompt.lower())
        self.assertIn("hand and leg positioning", prompt.lower())
        self.assertIn('"correct": true or false', prompt)

    def test_video_user_text_states_the_real_frame_count(self) -> None:
        text = build_verification_user_text("A red car.", media_kind="video", frame_count=5)

        self.assertIn("5 keyframes", text)
        self.assertNotIn(f"{VIDEO_KEYFRAME_COUNT} keyframes", text)

    def test_single_frame_user_text_is_singular(self) -> None:
        text = build_verification_user_text("Still.", media_kind="video", frame_count=1)

        self.assertIn("a single frame", text.lower())


def _image_payloads(messages: list[dict]) -> list[str]:
    """The base64 image URLs one request carried, in order."""
    parts = messages[1]["content"]
    return [
        part["image_url"]["url"]
        for part in parts
        if isinstance(part, dict) and part.get("type") == "image_url"
    ]


def _sent_image_pixels(captured: dict) -> int:
    """Decode the still this request actually carried, at the size it was sent."""
    parts = captured["messages"][1]["content"]
    url = next(part["image_url"]["url"] for part in parts if part["type"] == "image_url")
    image = Image.open(BytesIO(base64.b64decode(url.split(",", 1)[1])))
    return image.width * image.height


class VerifyCaptionsApiTests(unittest.TestCase):
    def test_a_configured_still_budget_reaches_the_request(self) -> None:
        # Shared still budget is read per call; bound at import, the frame goes out at the default size.
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            frames = [Image.new("RGB", (2000, 2000), color="blue")]

            fake_client, captured = _make_fake_verify_client()
            with patch.dict(os.environ, {IMAGE_MAX_PIXELS_VAR: "400000"}):
                verify_caption(
                    fake_client,
                    media,
                    build_verification_system_prompt(),
                    "A blue car in the rain.",
                    images=frames,
                )

            self.assertLessEqual(_sent_image_pixels(captured), 400_000)

    def test_a_still_defaults_to_the_shared_image_budget(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            frames = [Image.new("RGB", (2000, 2000), color="blue")]

            fake_client, captured = _make_fake_verify_client()
            verify_caption(
                fake_client,
                media,
                build_verification_system_prompt(),
                "A blue car in the rain.",
                images=frames,
            )

            pixels = _sent_image_pixels(captured)
            self.assertLessEqual(pixels, IMAGE_MAX_PIXELS)
            self.assertGreater(pixels, 400_000)

    def test_verify_caption_uses_instruct_params_when_requested(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")

            fake_client, captured = _make_fake_verify_client()
            frames = [Image.new("RGB", (128, 128), color="blue")]
            response = verify_caption(
                fake_client,
                media,
                build_verification_system_prompt(),
                "A blue car in the rain.",
                images=frames,
                mode="instruct",
            )

            self.assertIsNotNone(response)
            self.assertEqual(captured["temperature"], 0.7)
            self.assertEqual(captured["top_p"], 0.8)
            self.assertEqual(captured["presence_penalty"], 1.5)

            msgs = captured["messages"]
            self.assertIsNotNone(msgs)
            self.assertEqual(len(msgs), 3)
            self.assertEqual(msgs[2]["content"], INSTRUCT_THINK_PREFILL)
            self.assertIn(
                "enable_thinking",
                captured["extra_body"]["chat_template_kwargs"],
            )

    def test_verify_caption_uses_thinking_params_when_requested(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")

            fake_client, captured = _make_fake_verify_client()
            frames = [Image.new("RGB", (128, 128), color="blue")]
            verify_caption(
                fake_client,
                media,
                build_verification_system_prompt("Outdoor portraits."),
                "A hiker on a trail.",
                images=frames,
                mode="thinking",
            )

            self.assertEqual(captured["temperature"], 1.0)
            self.assertEqual(captured["presence_penalty"], 0.0)
            self.assertEqual(len(captured["messages"]), 2)
            self.assertEqual(
                captured["extra_body"]["chat_template_kwargs"],
                {"reasoning_effort": "medium", "preserve_thinking": True},
            )
            self.assertEqual(captured["extra_body"]["reasoning_effort"], "medium")
            self.assertIn("Outdoor portraits.", captured["messages"][0]["content"])

    def test_verify_caption_forwards_reasoning_effort(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")

            fake_client, captured = _make_fake_verify_client()
            frames = [Image.new("RGB", (128, 128), color="blue")]
            verify_caption(
                fake_client,
                media,
                build_verification_system_prompt(),
                "A hiker on a trail.",
                images=frames,
                mode="thinking",
                effort="low",
                preserve_thinking=False,
            )

            self.assertEqual(
                captured["extra_body"]["chat_template_kwargs"],
                {"reasoning_effort": "low", "preserve_thinking": False},
            )
            self.assertEqual(captured["extra_body"]["reasoning_effort"], "low")

    def test_verify_caption_forwards_configured_repeat_penalty(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            frames = [Image.new("RGB", (128, 128), color="blue")]

            with patch.dict("os.environ", {"OPENAI_THINKING_REPEAT_PENALTY": "1.1"}, clear=False):
                fake_client, captured = _make_fake_verify_client()
                verify_caption(
                    fake_client,
                    media,
                    build_verification_system_prompt(),
                    "A blue car in the rain.",
                    images=frames,
                    mode="thinking",
                )
                self.assertEqual(captured["extra_body"].get("repeat_penalty"), 1.1)

            # Unset the key rather than fall back to 1.0, so unknown servers keep the old request.
            fake_client, captured = _make_fake_verify_client()
            verify_caption(
                fake_client,
                media,
                build_verification_system_prompt(),
                "A blue car in the rain.",
                images=frames,
                mode="thinking",
            )
            self.assertNotIn("repeat_penalty", captured["extra_body"])

    def test_verify_caption_reasoning_fallback_only_in_instruct(self) -> None:
        payload = _fixes_json(DEFAULT_FIX)
        frames = [Image.new("RGB", (128, 128), color="blue")]
        kwargs = {
            "content": "",
            "reasoning_content": f"```json\n{payload}\n```",
        }

        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            system = build_verification_system_prompt()
            caption = "A blue car in the rain."

            instruct_client, _ = _make_fake_verify_client(**kwargs)
            instruct_raw = verify_caption(
                instruct_client, media, system, caption, images=frames, mode="instruct"
            )
            self.assertIsNotNone(instruct_raw)
            parsed = parse_verification_response(instruct_raw or "")
            self.assertIsNotNone(parsed)
            assert parsed is not None
            self.assertEqual(parsed.fixes, (DEFAULT_FIX,))

            thinking_client, _ = _make_fake_verify_client(**kwargs)
            self.assertIsNone(
                verify_caption(
                    thinking_client, media, system, caption, images=frames, mode="thinking"
                )
            )


class VerifyCaptionsMediaListingTests(unittest.TestCase):
    def test_list_media_includes_images_videos_and_gifs(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")
            # A GIF is a frame sequence and is verified via keyframes like a video.
            write_gif(root, "loop.gif")

            names = [path.name for path in list_verify_captions_media(root)]

            self.assertEqual(names, ["clip.mp4", "loop.gif", "photo.png"])


class VerifyCaptionsFolderValidationTests(unittest.TestCase):
    def test_validate_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_verify_captions_folder(root)

    def test_validate_accepts_folder_with_images_only(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            validate_verify_captions_folder(root)

    def test_validate_accepts_folder_with_motion_only(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4")
            write_gif(root, "loop.gif")

            validate_verify_captions_folder(root)


class VerifyCaptionsJobRunTests(unittest.TestCase):
    def test_run_job_writes_issue_file_when_issue_detected(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A blue car in the rain.")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_fixes_json('Replace "blue" with "red".', 'Remove "in the rain".'),
            ):
                result = run_verify_captions_job(root)

            issue_path = issue_file_path(media)
            self.assertTrue(issue_path.is_file())
            issue_data = json.loads(issue_path.read_text(encoding="utf-8"))
            self.assertEqual(
                issue_data,
                {"fixes": ['Replace "blue" with "red".', 'Remove "in the rain".']},
            )
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["stats"]["issues_found"], 1)

    def test_run_job_skips_issue_file_when_caption_is_correct(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A red car.")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_fixes_json(),
            ):
                result = run_verify_captions_job(root)

            self.assertFalse(issue_file_path(media).exists())
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["stats"]["issues_found"], 0)

    def test_run_job_leaves_unselected_files_alone(self) -> None:
        """Only the files the job verified are rewritten; the rest keep their findings."""
        with TempMediaFolder() as root:
            selected = write_media(root, "selected.png")
            unselected = write_media(root, "unselected.png")
            write_txt_caption(selected, "Selected caption.")
            write_txt_caption(unselected, "Unselected caption.")
            issue_file_path(selected).write_text('{"fixes":["old-selected"]}', encoding="utf-8")
            issue_file_path(unselected).write_text('{"fixes":["old-unselected"]}', encoding="utf-8")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_fixes_json(),
            ):
                run_verify_captions_job(root, selected_paths=[selected])

            self.assertFalse(issue_file_path(selected).exists())
            self.assertEqual(load_issue_summary(unselected)[0], ["old-unselected"])

    def test_run_job_removes_a_sidecar_holding_only_stale_caption_findings(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A red car.")
            issue_file_path(media).write_text('{"fixes":["old"]}', encoding="utf-8")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_fixes_json(),
            ):
                run_verify_captions_job(root)

            self.assertFalse(issue_file_path(media).exists())

    def test_a_clean_file_does_not_clear_a_stem_sharer_findings(self) -> None:
        """A generated folder holds clip.mp4 beside the clip.png that previews it.

        Both once shared one stem-named sidecar, and the job clears the findings of every
        file that verifies clean - so whichever the run reached last decided what the
        folder remembered. The still sorts after the video, so it always won.
        """
        with TempMediaFolder() as root:
            flagged = write_media(root, "clip.jpg")
            clean = write_media(root, "clip.png")
            write_txt_caption(flagged, "A caption that misses something.")
            write_txt_caption(clean, "An accurate caption.")

            def verdict(_client, media_path, *_args, **_kwargs):
                if media_path.name == flagged.name:
                    return _fixes_json("The caption omits the mountains.")
                return _fixes_json()

            with patch("automation.verify_captions.verify_caption", side_effect=verdict):
                run_verify_captions_job(root)

            self.assertEqual(load_issue_summary(flagged)[0], ["The caption omits the mountains."])
            self.assertEqual(load_issue_summary(clean), ([], False))

    def test_run_job_records_api_errors(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.verify_captions.verify_caption", return_value=None
            ) as mock_verify:
                result = run_verify_captions_job(root)

            self.assertEqual(result["stats"]["api_error"], 1)
            self.assertEqual(mock_verify.call_count, MAX_MODEL_ATTEMPTS)

    def test_run_job_records_parse_errors(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value="not valid json",
            ) as mock_verify:
                result = run_verify_captions_job(root)

            self.assertEqual(result["stats"]["parse_error"], 1)
            self.assertIn("not valid JSON", str(result["results"][0]["message"]))
            self.assertEqual(mock_verify.call_count, MAX_MODEL_ATTEMPTS)

    def test_process_media_retries_parse_errors_then_succeeds(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            responses = [
                "not valid json",
                "{broken",
                _fixes_json(),
            ]

            with patch(
                "automation.verify_captions.verify_caption",
                side_effect=responses,
            ) as mock_verify:
                _path, verification, status, message = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "video system prompt"},
                )

            self.assertEqual(status, "success")
            self.assertIsNone(message)
            self.assertIsNotNone(verification)
            self.assertEqual(verification.fixes, ())
            self.assertEqual(mock_verify.call_count, 3)

    def test_process_media_retries_api_errors_then_succeeds(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            responses = [
                None,
                None,
                _fixes_json(),
            ]

            with patch(
                "automation.verify_captions.verify_caption",
                side_effect=responses,
            ) as mock_verify:
                _path, verification, status, message = process_media(
                    object(),
                    media,
                    {"image": "system prompt", "video": "video system prompt"},
                )

            self.assertEqual(status, "success")
            self.assertIsNone(message)
            self.assertIsNotNone(verification)
            self.assertEqual(mock_verify.call_count, 3)

    def test_a_retry_re_encodes_the_frames_the_failed_attempt_sent(self) -> None:
        # WORKAROUND: llama.cpp short-circuits byte-identical multimodal retries.
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            # Unparseable every time, so the attempts run out and all three are visible.
            fake_client, captured = _make_fake_verify_client(content="not json at all")
            _path, _verification, status, _message = process_media(
                fake_client,
                media,
                {"image": "system prompt", "video": "video system prompt"},
            )

            self.assertEqual(status, "parse_error")
            self.assertEqual(len(captured["requests"]), MAX_MODEL_ATTEMPTS)
            sent = [_image_payloads(request) for request in captured["requests"]]
            self.assertEqual(len({tuple(images) for images in sent}), MAX_MODEL_ATTEMPTS)
            # Same still throughout - it is the encoding that differs, not the media.
            self.assertEqual({len(images) for images in sent}, {1})

    def test_processed_count_does_not_double_count_issues_found(self) -> None:
        with TempMediaFolder() as root:
            issue_media = write_media(root, "issue.png")
            ok_media = write_media(root, "ok.png")
            write_txt_caption(issue_media, "Wrong caption.")
            write_txt_caption(ok_media, "Correct caption.")

            def fake_verify(_client, media_path, *_args, **_kwargs):
                if media_path.name == "issue.png":
                    return _fixes_json(DEFAULT_FIX)
                return _fixes_json()

            with patch("automation.verify_captions.verify_caption", side_effect=fake_verify):
                result = run_verify_captions_job(root, mode="thinking", context="Test context.")

            self.assertEqual(result["total"], 2)
            self.assertEqual(result["processed"], 2)
            self.assertEqual(result["stats"]["success"], 2)
            self.assertEqual(result["stats"]["issues_found"], 1)

    def test_run_job_verifies_gif_and_video_captions(self) -> None:
        with TempMediaFolder() as root:
            gif = write_gif(root, "loop.gif", frames=8)
            video = write_mp4_video(root, "clip.mp4")
            write_txt_caption(gif, "An animated loop.")
            write_txt_caption(video, "A short clip.")
            frames = [Image.new("RGB", (64, 64), color="blue") for _ in range(3)]

            # Fixture MP4s are often not seekable; a successful load is enough to reach verify_caption.
            def fake_load(path):
                return MediaFrames(images=frames), None

            with (
                patch("automation.verify_captions.load_media_images", side_effect=fake_load),
                patch(
                    "automation.verify_captions.verify_caption",
                    return_value=_fixes_json(),
                ) as mock_verify,
            ):
                result = run_verify_captions_job(root)

            self.assertEqual(result["stats"]["success"], 2)
            self.assertEqual(mock_verify.call_count, 2)
            verified_names = {call.args[1].name for call in mock_verify.call_args_list}
            self.assertEqual(verified_names, {"loop.gif", "clip.mp4"})

    def test_run_job_picks_the_prompt_matching_each_media_kind(self) -> None:
        # Nothing else catches a still checked against the keyframe prompt; GIF is the still side.
        with TempMediaFolder() as root:
            photo = write_media(root, "photo.png")
            gif = write_gif(root, "loop.gif", frames=8)
            video = write_mp4_video(root, "clip.mp4")
            write_txt_caption(photo, "A still.")
            write_txt_caption(gif, "An animated loop.")
            write_txt_caption(video, "A short clip.")
            frames = [Image.new("RGB", (64, 64), color="blue")]

            with (
                patch(
                    "automation.verify_captions.load_media_images",
                    side_effect=lambda _path: (MediaFrames(images=frames), None),
                ),
                patch(
                    "automation.verify_captions.verify_caption",
                    return_value=_fixes_json(),
                ) as mock_verify,
            ):
                run_verify_captions_job(root)

            prompts = {call.args[1].name: call.args[2] for call in mock_verify.call_args_list}
            image_prompt = build_verification_system_prompt(media_kind="image")
            self.assertEqual(prompts["photo.png"], image_prompt)
            self.assertEqual(prompts["loop.gif"], image_prompt)
            self.assertEqual(
                prompts["clip.mp4"], build_verification_system_prompt(media_kind="video")
            )

    def test_run_job_records_frame_errors(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.verify_captions.load_media_images",
                return_value=(None, MediaLoadError(FRAME_ERROR)),
            ):
                result = run_verify_captions_job(root)

            self.assertEqual(result["stats"]["frame_error"], 1)
            self.assertEqual(result["stats"]["success"], 0)
            self.assertFalse(issue_file_path(media).exists())

    def test_verify_caption_sends_a_gif_as_a_single_still(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif", frames=8)
            frames, error = load_media_images(media)
            self.assertIsNone(error)
            assert frames is not None
            self.assertEqual(len(frames.images), 1)
            self.assertEqual(media_kind_for(media), "image")

            fake_client, captured = _make_fake_verify_client()
            response = verify_caption(
                fake_client,
                media,
                build_verification_system_prompt(media_kind="image"),
                "An animated loop.",
                images=frames.images,
                timestamps=frames.timestamps,
                mode="instruct",
            )

            self.assertIsNotNone(response)
            user_content = captured["messages"][1]["content"]
            image_parts = [part for part in user_content if part.get("type") == "image_url"]
            text_parts = [part for part in user_content if part.get("type") == "text"]
            self.assertEqual(len(image_parts), 1)
            # One instruction and no frame labels: nothing claims a sequence.
            self.assertEqual(len(text_parts), 1)
            self.assertNotIn("keyframes", text_parts[0]["text"])

    def test_verification_never_sends_audio(self) -> None:
        """Auto-caption's audio option must not leak into the job that shares its plumbing."""
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif", frames=8)
            frames, _error = load_media_images(media)
            assert frames is not None

            for mode in ("thinking", "instruct"):
                with self.subTest(mode=mode):
                    fake_client, captured = _make_fake_verify_client()
                    verify_caption(
                        fake_client,
                        media,
                        build_verification_system_prompt(media_kind="image"),
                        "An animated loop.",
                        images=frames.images,
                        mode=mode,
                    )

                    user_content = captured["messages"][1]["content"]
                    self.assertEqual(
                        {part.get("type") for part in user_content},
                        {"image_url", "text"},
                    )
