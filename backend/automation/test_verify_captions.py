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

from app_settings import SETTING_DEFAULTS
from automation.auto_caption import complete_caption
from automation.llm import MAX_MODEL_ATTEMPTS
from automation.verify_captions import (
    _response_preview,
    build_verification_system_prompt,
    build_verification_user_text,
    list_verify_captions_media,
    parse_verification_response,
    process_media,
    run_verify_captions_job,
    split_fix_sentences,
    validate_verify_captions_folder,
    verify_caption,
)
from automation.vision import (
    FRAME_ERROR,
    VIDEO_KEYFRAME_COUNT,
    MediaFrames,
    MediaLoadError,
    load_media_images,
)
from captions import issue_file_path, load_issue_summary
from constants import MAX_ISSUE_FIXES
from testing_fixtures import (
    FakeChatClient,
    TempMediaFolder,
    image_urls,
    write_gif,
    write_issue_sidecar,
    write_media,
    write_mp4_video,
    write_txt_caption,
)

DEFAULT_FIX = 'Replace "a blue lake" with "a snow-covered mountain peak".'
SYSTEM_PROMPTS = {"image": "system prompt", "video": "video system prompt"}


def _rules_section(prompt: str) -> str:
    return prompt[prompt.index("# Rules") : prompt.index("# Output Format")]


def _fixes_json(*fixes: str, correct: bool | None = None) -> str:
    """Build a model response: fixes become the sentences of the ``issues`` prose."""
    verdict = not fixes if correct is None else correct
    return json.dumps({"correct": verdict, "issues": " ".join(fixes) if fixes else "None"})


def _verdict_client(content: str | None = None) -> FakeChatClient:
    return FakeChatClient(_fixes_json(DEFAULT_FIX) if content is None else content)


class VerifyCaptionsParsingTests(unittest.TestCase):
    def test_normalizes_decoded_quotes_before_splitting_sentences(self) -> None:
        for escape in ("", "\\", "\\\\"):
            with self.subTest(escape=escape):
                quote = escape + '"'
                issues = f"Remove {quote}blue lake. green trees,{quote}. Mention rain."
                raw = json.dumps({"correct": False, "issues": issues})

                parsed = parse_verification_response(raw)

                assert parsed is not None
                self.assertEqual(
                    parsed.fixes,
                    ('Remove "blue lake. green trees".', "Mention rain."),
                )

    def test_parses_each_response_shape_into_its_fixes(self) -> None:
        cases = {
            "plain JSON": (_fixes_json(DEFAULT_FIX), (DEFAULT_FIX,)),
            "fences and thinking tags": (
                "<think>\nmaybe wrong\n</think>\n```json\n" + _fixes_json(DEFAULT_FIX) + "\n```",
                (DEFAULT_FIX,),
            ),
            # Curly quotes leave the splitter blind to the span, fragmenting one finding in two.
            "typographic quotes": (
                json.dumps(
                    {
                        "correct": False,
                        "issues": "Replace “a blue car. parked outside” with “a red car”.",
                    }
                ),
                ('Replace "a blue car. parked outside" with "a red car".',),
            ),
            "string verdict": (
                json.dumps({"correct": "no", "issues": DEFAULT_FIX}),
                (DEFAULT_FIX,),
            ),
            "JSON embedded in prose": (
                "Here is my evaluation:\n" + _fixes_json(DEFAULT_FIX),
                (DEFAULT_FIX,),
            ),
            "true verdict": (_fixes_json(), ()),
            # Contradictions resolve toward "no issue" - the direction that avoids false flags.
            "true verdict outranks issues": (_fixes_json(DEFAULT_FIX, correct=True), ()),
            "false verdict with sentinel issues": (
                json.dumps({"correct": False, "issues": "None"}),
                (),
            ),
            "false verdict without fixes": (_fixes_json(correct=False), ()),
            "prose split into fixes": (
                json.dumps({"correct": False, "issues": f'{DEFAULT_FIX} Remove "at dusk".'}),
                (DEFAULT_FIX, 'Remove "at dusk".'),
            ),
            "capped at the most important fixes": (
                json.dumps({"correct": False, "issues": "First. Second. Third. Fourth. Fifth."}),
                ("First.", "Second.", "Third."),
            ),
        }
        for name, (raw, expected) in cases.items():
            with self.subTest(name):
                parsed = parse_verification_response(raw)

                assert parsed is not None
                self.assertEqual(parsed.fixes, expected)

    def test_rejects_responses_it_cannot_trust(self) -> None:
        """An unverdicted response is retried rather than trusted."""
        for raw in (
            "not json",
            json.dumps({"issues": DEFAULT_FIX}),
            json.dumps({"correct": "maybe"}),
            json.dumps({"correct": False, "issues": [DEFAULT_FIX]}),
        ):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_verification_response(raw))


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


def _sent_image_pixels(client: FakeChatClient) -> int:
    """Decode the still this request actually carried, at the size it was sent."""
    url = image_urls(client.last["messages"])[0]
    image = Image.open(BytesIO(base64.b64decode(url.split(",", 1)[1])))
    return image.width * image.height


class VerifyCaptionsApiTests(unittest.TestCase):
    def test_default_quality_matches_auto_caption(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            frames = [Image.new("RGB", (160, 96), color="blue")]
            auto = _verdict_client()
            verify = _verdict_client()

            complete_caption(auto, media, "Caption accurately.", "A blue landscape.", images=frames)
            verify_caption(
                verify,
                media,
                build_verification_system_prompt(),
                "A blue landscape.",
                images=frames,
            )

        quality_fields = ("temperature", "top_p", "presence_penalty", "max_tokens", "extra_body")
        self.assertEqual(
            {field: auto.last[field] for field in quality_fields},
            {field: verify.last[field] for field in quality_fields},
        )
        self.assertEqual(image_urls(auto.last["messages"]), image_urls(verify.last["messages"]))

    def test_the_still_budget_is_read_per_call(self) -> None:
        # Bound at import, the frame would go out at the default size.
        with TempMediaFolder() as root:
            media = write_media(root, "img.png")
            frames = [Image.new("RGB", (2000, 2000), color="blue")]
            system = build_verification_system_prompt()

            default = _verdict_client()
            verify_caption(default, media, system, "A blue car in the rain.", images=frames)
            configured = _verdict_client()
            with patch.dict(os.environ, {"IMAGE_MAX_PIXELS": "400000"}):
                verify_caption(configured, media, system, "A blue car in the rain.", images=frames)

        self.assertLessEqual(_sent_image_pixels(configured), 400_000)
        self.assertLessEqual(_sent_image_pixels(default), SETTING_DEFAULTS.image_max_pixels)
        self.assertGreater(_sent_image_pixels(default), 400_000)


class VerifyCaptionsMediaListingTests(unittest.TestCase):
    def test_list_media_includes_images_videos_and_gifs(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")
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

            issue_data = json.loads(issue_file_path(media).read_text(encoding="utf-8"))

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

    def test_a_clean_verdict_keeps_the_caption_rule_hits(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A red car floating.")
            write_issue_sidecar(media, "old", rules=('Flagged "floating".',))

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_fixes_json(),
            ):
                run_verify_captions_job(root)

            self.assertEqual(load_issue_summary(media), ([], ['Flagged "floating".'], True))

    def test_a_clean_file_does_not_clear_a_stem_sharer_findings(self) -> None:
        """clip.jpg and clip.png once shared one stem-named sidecar, so the last one verified won."""
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
            self.assertEqual(load_issue_summary(clean), ([], [], False))

    def test_run_job_records_model_failures_after_every_attempt(self) -> None:
        for response, status in ((None, "api_error"), ("not valid json", "parse_error")):
            with (
                self.subTest(status=status),
                TempMediaFolder() as root,
                patch(
                    "automation.verify_captions.verify_caption", return_value=response
                ) as mock_verify,
            ):
                write_txt_caption(write_media(root, "photo.png"), "Draft.")

                result = run_verify_captions_job(root)

                self.assertEqual(result["stats"][status], 1)
                self.assertEqual(mock_verify.call_count, MAX_MODEL_ATTEMPTS)
                if status == "parse_error":
                    self.assertIn("not valid JSON", str(result["results"][0]["message"]))

    def test_process_media_retries_failures_then_succeeds(self) -> None:
        for failures in (["not valid json", "{broken"], [None, None]):
            with (
                self.subTest(failures=failures),
                TempMediaFolder() as root,
                patch(
                    "automation.verify_captions.verify_caption",
                    side_effect=[*failures, _fixes_json()],
                ) as mock_verify,
            ):
                media = write_media(root, "photo.png")
                write_txt_caption(media, "Draft.")

                verification, status, message = process_media(object(), media, SYSTEM_PROMPTS)

                self.assertEqual(status, "success")
                self.assertIsNone(message)
                assert verification is not None
                self.assertEqual(verification.fixes, ())
                self.assertEqual(mock_verify.call_count, 3)

    def test_a_retry_re_encodes_the_frames_the_failed_attempt_sent(self) -> None:
        # WORKAROUND: llama.cpp short-circuits byte-identical multimodal retries.
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            # Unparseable every time, so the attempts run out and all three are visible.
            client = FakeChatClient("not json at all")
            _verification, status, _message = process_media(client, media, SYSTEM_PROMPTS)

        self.assertEqual(status, "parse_error")
        sent = [image_urls(request["messages"]) for request in client.requests]
        self.assertEqual(len(sent), MAX_MODEL_ATTEMPTS)
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
                    side_effect=lambda _path: MediaFrames(images=frames),
                ),
                patch(
                    "automation.verify_captions.verify_caption",
                    return_value=_fixes_json(),
                ) as mock_verify,
            ):
                result = run_verify_captions_job(root)

        self.assertEqual(result["stats"]["success"], 3)
        prompts = {call.args[1].name: call.args[2] for call in mock_verify.call_args_list}
        image_prompt = build_verification_system_prompt(media_kind="image")
        self.assertEqual(prompts["photo.png"], image_prompt)
        self.assertEqual(prompts["loop.gif"], image_prompt)
        self.assertEqual(prompts["clip.mp4"], build_verification_system_prompt(media_kind="video"))

    def test_run_job_records_frame_errors(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            write_txt_caption(media, "Draft.")

            with patch(
                "automation.verify_captions.load_media_images",
                return_value=MediaLoadError(FRAME_ERROR),
            ):
                result = run_verify_captions_job(root)

            self.assertFalse(issue_file_path(media).exists())

        self.assertEqual(result["stats"]["frame_error"], 1)
        self.assertEqual(result["stats"]["success"], 0)

    def test_a_gif_goes_out_as_one_unlabelled_still_without_audio(self) -> None:
        """Auto-caption's audio option must not leak into the job that shares its plumbing."""
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif", frames=8)
            frames = load_media_images(media)
            assert isinstance(frames, MediaFrames)

            for mode in ("thinking", "instruct"):
                with self.subTest(mode=mode):
                    client = _verdict_client()
                    verify_caption(
                        client,
                        media,
                        build_verification_system_prompt(media_kind="image"),
                        "An animated loop.",
                        images=frames.images,
                        timestamps=frames.timestamps,
                        mode=mode,
                    )

                    user_content = client.last["messages"][1]["content"]
                    types = [part.get("type") for part in user_content]
                    # One instruction and no frame labels: nothing claims a sequence.
                    self.assertEqual(sorted(types), ["image_url", "text"])
                    text = next(part["text"] for part in user_content if part["type"] == "text")
                    self.assertNotIn("keyframes", text)


if __name__ == "__main__":
    unittest.main()
