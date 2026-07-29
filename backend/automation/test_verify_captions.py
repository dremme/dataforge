"""Unit tests for automation.verify_captions."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from PIL import Image

from automation.verify_captions import (
    INSTRUCT_THINK_PREFILL,
    MAX_MODEL_ATTEMPTS,
    VerificationResult,
    build_verification_system_prompt,
    list_verify_captions_media,
    normalize_verification_result,
    parse_verification_response,
    process_media,
    run_verify_captions_job,
    should_write_issue_file,
    validate_verify_captions_folder,
    verify_caption,
)
from captions import issue_file_path
from testing_fixtures import (
    TempMediaFolder,
    write_media,
    write_mp4_video,
    write_txt_caption,
)


def _verification_json(
    *,
    correct: bool = False,
    issues: str = "Wrong subject described.",
    suggestions: str = "Mention the mountain peak.",
) -> str:
    return json.dumps(
        {
            "correct": correct,
            "issues": issues,
            "suggestions": suggestions,
        }
    )


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
        content = _verification_json()
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
            choice = type("Choice", (), {"message": message})()
            return type("Response", (), {"choices": [choice]})()

    class FakeClient:
        def __init__(self) -> None:
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    return FakeClient(), captured


class VerifyCaptionsParsingTests(unittest.TestCase):
    def test_parse_valid_json_response(self) -> None:
        parsed = parse_verification_response(_verification_json())

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertFalse(parsed.correct)
        self.assertEqual(parsed.issues, "Wrong subject described.")

    def test_parse_strips_markdown_fences_and_thinking_tags(self) -> None:
        raw = (
            "<think>\nmaybe wrong\n</think>\n"
            "```json\n"
            + _verification_json(correct=True, issues="None", suggestions="None")
            + "\n```"
        )

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertTrue(parsed.correct)

    def test_parse_rejects_invalid_json(self) -> None:
        self.assertIsNone(parse_verification_response("not json"))

    def test_parse_extracts_json_embedded_in_prose(self) -> None:
        raw = "Here is my evaluation:\n" + _verification_json(
            correct=True, issues="None", suggestions="None"
        )

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertTrue(parsed.correct)

    def test_parse_ignores_legacy_severity_and_confidence_fields(self) -> None:
        raw = json.dumps(
            {
                "correct": False,
                "issues": "Caption says blue car but image shows red car.",
                "suggestions": "Change to red car.",
                "severity": "critical",
                "confidence": 0.95,
            }
        )

        parsed = parse_verification_response(raw)

        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertFalse(parsed.correct)

    def test_should_write_issue_only_for_incorrect_captions_with_substantive_issues(
        self,
    ) -> None:
        mismatch = VerificationResult(
            correct=False,
            issues="Mismatch",
            suggestions="Fix it",
        )
        correct = VerificationResult(
            correct=True,
            issues="None",
            suggestions="None",
        )
        empty_issue = VerificationResult(
            correct=False,
            issues="None",
            suggestions="None",
        )

        self.assertTrue(should_write_issue_file(mismatch))
        self.assertFalse(should_write_issue_file(correct))
        self.assertFalse(should_write_issue_file(empty_issue))


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

    def test_build_system_prompt_uses_simplified_json_schema(self) -> None:
        prompt = build_verification_system_prompt()

        self.assertIn('"correct": true or false', prompt)
        self.assertIn('"issues":', prompt)
        self.assertIn('"suggestions":', prompt)
        self.assertNotIn("confidence", prompt.lower())
        self.assertNotIn("severity", prompt.lower())


class VerifyCaptionsNormalizeTests(unittest.TestCase):
    def test_normalize_discards_incorrect_without_substantive_issues(self) -> None:
        verification = VerificationResult(
            correct=False,
            issues="None",
            suggestions="None",
        )

        normalized = normalize_verification_result(verification)

        self.assertTrue(normalized.correct)

    def test_normalize_keeps_factual_mismatch(self) -> None:
        verification = VerificationResult(
            correct=False,
            issues='Caption says "blue car" but the image shows a red car.',
            suggestions='Change to "red car".',
        )

        normalized = normalize_verification_result(verification)

        self.assertFalse(normalized.correct)


class VerifyCaptionsApiTests(unittest.TestCase):
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
            self.assertNotIn("chat_template_kwargs", captured["extra_body"])
            self.assertIn("Outdoor portraits.", captured["messages"][0]["content"])

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

            # Unset again: the key must disappear rather than fall back to 1.0,
            # so servers that do not recognise it keep seeing the pre-existing request.
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
        payload = _verification_json(correct=True, issues="None", suggestions="None")
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
            self.assertTrue(parsed.correct)

            thinking_client, _ = _make_fake_verify_client(**kwargs)
            self.assertIsNone(
                verify_caption(
                    thinking_client, media, system, caption, images=frames, mode="thinking"
                )
            )


class VerifyCaptionsMediaListingTests(unittest.TestCase):
    def test_list_media_includes_images_only(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")

            names = [path.name for path in list_verify_captions_media(root)]

            self.assertEqual(names, ["photo.png"])


class VerifyCaptionsFolderValidationTests(unittest.TestCase):
    def test_validate_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No supported images"):
                validate_verify_captions_folder(root)

    def test_validate_accepts_folder_with_images_only(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            validate_verify_captions_folder(root)


class VerifyCaptionsJobRunTests(unittest.TestCase):
    def test_run_job_writes_issue_file_when_issue_detected(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A blue car in the rain.")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_verification_json(issues="Car is red, not blue."),
            ):
                result = run_verify_captions_job(root)

            issue_path = issue_file_path(media)
            self.assertTrue(issue_path.is_file())
            issue_data = json.loads(issue_path.read_text(encoding="utf-8"))
            self.assertFalse(issue_data["correct"])
            self.assertEqual(issue_data["issues"], "Car is red, not blue.")
            self.assertNotIn("severity", issue_data)
            self.assertNotIn("confidence", issue_data)
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["stats"]["issues_found"], 1)

    def test_run_job_skips_issue_file_when_caption_is_correct(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A red car.")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_verification_json(
                    correct=True,
                    issues="None",
                    suggestions="None",
                ),
            ):
                result = run_verify_captions_job(root)

            self.assertFalse(issue_file_path(media).exists())
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["stats"]["issues_found"], 0)

    def test_run_job_clears_existing_issue_sidecars_at_start(self) -> None:
        with TempMediaFolder() as root:
            selected = write_media(root, "selected.png")
            unselected = write_media(root, "unselected.png")
            write_txt_caption(selected, "Selected caption.")
            write_txt_caption(unselected, "Unselected caption.")
            issue_file_path(selected).write_text('{"issues":"old-selected"}', encoding="utf-8")
            issue_file_path(unselected).write_text('{"issues":"old-unselected"}', encoding="utf-8")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_verification_json(
                    correct=True,
                    issues="None",
                    suggestions="None",
                ),
            ):
                run_verify_captions_job(root, selected_paths=[selected])

            self.assertFalse(issue_file_path(selected).exists())
            self.assertFalse(issue_file_path(unselected).exists())

    def test_run_job_removes_stale_issue_file_when_reverified_ok(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A red car.")
            issue_file_path(media).write_text('{"issues":"old"}', encoding="utf-8")

            with patch(
                "automation.verify_captions.verify_caption",
                return_value=_verification_json(
                    correct=True,
                    issues="None",
                    suggestions="None",
                ),
            ):
                run_verify_captions_job(root)

            self.assertFalse(issue_file_path(media).exists())

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
                _verification_json(correct=True, issues="None", suggestions="None"),
            ]

            with patch(
                "automation.verify_captions.verify_caption",
                side_effect=responses,
            ) as mock_verify:
                _path, verification, status, message = process_media(
                    object(),
                    media,
                    "system prompt",
                )

            self.assertEqual(status, "success")
            self.assertIsNone(message)
            self.assertIsNotNone(verification)
            self.assertTrue(verification.correct)
            self.assertEqual(mock_verify.call_count, 3)

    def test_process_media_retries_api_errors_then_succeeds(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            responses = [
                None,
                None,
                _verification_json(correct=True, issues="None", suggestions="None"),
            ]

            with patch(
                "automation.verify_captions.verify_caption",
                side_effect=responses,
            ) as mock_verify:
                _path, verification, status, message = process_media(
                    object(),
                    media,
                    "system prompt",
                )

            self.assertEqual(status, "success")
            self.assertIsNone(message)
            self.assertIsNotNone(verification)
            self.assertEqual(mock_verify.call_count, 3)

    def test_processed_count_does_not_double_count_issues_found(self) -> None:
        with TempMediaFolder() as root:
            issue_media = write_media(root, "issue.png")
            ok_media = write_media(root, "ok.png")
            write_txt_caption(issue_media, "Wrong caption.")
            write_txt_caption(ok_media, "Correct caption.")

            def fake_verify(_client, media_path, *_args, **_kwargs):
                if media_path.name == "issue.png":
                    return _verification_json(issues="Caption does not match.")
                return _verification_json(
                    correct=True,
                    issues="None",
                    suggestions="None",
                )

            with patch("automation.verify_captions.verify_caption", side_effect=fake_verify):
                result = run_verify_captions_job(root, mode="thinking", context="Test context.")

            self.assertEqual(result["total"], 2)
            self.assertEqual(result["processed"], 2)
            self.assertEqual(result["stats"]["success"], 2)
            self.assertEqual(result["stats"]["issues_found"], 1)
