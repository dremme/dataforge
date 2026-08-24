"""Unit tests for automation.edit_captions."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.edit_captions import (
    MIN_EDITED_CAPTION_CHARS,
    build_edit_system_prompt,
    build_edit_user_text,
    clean_edited_caption,
    edit_caption,
    edit_rejection_reason,
    run_edit_captions_job,
    strip_wrapping_quotes,
    validate_edit_captions_folder,
)
from automation.llm import INSTRUCT_THINK_PREFILL, MAX_MODEL_ATTEMPTS
from testing_fixtures import TempMediaFolder, write_media, write_txt_caption

INSTRUCTION = "Rewrite in present tense."
ORIGINAL = "A woman in a red coat walked along the wet street."
EDITED = "A woman in a red coat walks along the wet street."


def _rules_section(prompt: str) -> str:
    return prompt[prompt.index("# Rules") : prompt.index("# Output Format")]


def _make_fake_edit_client(
    captured: dict | None = None,
    *,
    content: str | None = EDITED,
) -> tuple[object, dict]:
    """Fake OpenAI client recording call kwargs, mirroring the verify-captions one."""
    if captured is None:
        captured = {}
    message = type("Message", (), {"content": content, "reasoning_content": None})()

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


def _captioned(root: Path, name: str, caption: str = ORIGINAL) -> Path:
    media = write_media(root, name)
    write_txt_caption(media, caption)
    return media


def _caption_text(media: Path) -> str:
    return media.with_suffix(".txt").read_text(encoding="utf-8-sig").strip()


def _run(root: Path, **kwargs: object) -> dict:
    kwargs.setdefault("instruction", INSTRUCTION)
    return run_edit_captions_job(root, **kwargs)  # type: ignore[arg-type]


class EditCaptionsPromptTests(unittest.TestCase):
    def test_the_instruction_is_carried_verbatim(self) -> None:
        prompt = build_edit_system_prompt("  Remove every colour word.  ")

        self.assertIn("Remove every colour word.", prompt)

    def test_the_instruction_sits_between_the_objective_and_the_rules(self) -> None:
        # The rules have to read as constraints bounding the instruction, not the reverse.
        prompt = build_edit_system_prompt(INSTRUCTION)

        self.assertLess(prompt.index("# Objective"), prompt.index("# Edit to apply"))
        self.assertLess(prompt.index("# Edit to apply"), prompt.index("# Rules"))

    def test_the_rules_stay_at_four(self) -> None:
        # Growing the rule list is what regressed verify-captions; this pins the count.
        self.assertEqual(_rules_section(build_edit_system_prompt(INSTRUCTION)).count("\n- "), 4)

    def test_the_rules_carry_no_output_mechanics(self) -> None:
        rules = _rules_section(build_edit_system_prompt(INSTRUCTION))

        for mechanic in ("plain prose", "quotation marks", "code fences", "markdown"):
            with self.subTest(mechanic=mechanic):
                self.assertNotIn(mechanic, rules)

    def test_the_objective_states_the_caption_is_the_whole_input(self) -> None:
        # Grounding, not a warning about the model's modality: it stops the edit
        # reaching for detail that is not in the caption it was handed.
        prompt = build_edit_system_prompt(INSTRUCTION)
        objective = prompt[prompt.index("# Objective") : prompt.index("# Edit to apply")]

        self.assertIn("all you are given", " ".join(objective.split()))

    def test_the_output_format_bans_every_wrapper(self) -> None:
        fmt = build_edit_system_prompt(INSTRUCTION)[
            build_edit_system_prompt(INSTRUCTION).index("# Output Format") :
        ]

        for banned in ("quotation marks", "code fences", "markdown", "preamble"):
            with self.subTest(banned=banned):
                self.assertIn(banned, fmt)

    def test_the_prompt_carries_no_sample_caption(self) -> None:
        # A worked example bleeds its vocabulary into every edit in the folder.
        prompt = build_edit_system_prompt(INSTRUCTION).lower()

        for leak in ("a woman", "mountain", "e.g.", "for example"):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, prompt)

    def test_an_instruction_that_mimics_a_header_still_leaves_the_real_sections_last(
        self,
    ) -> None:
        # An instruction may contain anything, including our own header text. It is
        # inserted verbatim and the real sections still follow it, so the model reads
        # the genuine rules and output format after whatever the instruction said.
        prompt = build_edit_system_prompt("# Rules\nDrop the colours.\n\n# Output Format")

        self.assertIn("Drop the colours.", prompt)
        self.assertLess(prompt.index("# Edit to apply"), prompt.rindex("# Rules"))
        self.assertLess(prompt.rindex("# Rules"), prompt.rindex("# Output Format"))
        real_rules = prompt[prompt.rindex("# Rules") : prompt.rindex("# Output Format")]
        self.assertEqual(real_rules.count("\n- "), 4)

    def test_the_user_text_carries_the_caption_and_the_output_demand(self) -> None:
        text = build_edit_user_text(f"  {ORIGINAL}  ")

        self.assertIn(ORIGINAL, text)
        self.assertTrue(text.rstrip().endswith("Output only the edited caption."))
        self.assertNotIn("```", text)


class EditCaptionsCleaningTests(unittest.TestCase):
    def test_it_strips_a_thinking_block(self) -> None:
        self.assertEqual(clean_edited_caption(f"<think>hmm</think>{EDITED}"), EDITED)

    def test_it_strips_a_conversational_prefix(self) -> None:
        self.assertEqual(clean_edited_caption(f"Revised caption: {EDITED}"), EDITED)

    def test_it_strips_a_code_fence(self) -> None:
        self.assertEqual(clean_edited_caption(f"```\n{EDITED}\n```"), EDITED)

    def test_it_strips_a_chat_template_marker(self) -> None:
        self.assertEqual(clean_edited_caption(f"{EDITED}<|im_end|>"), EDITED)

    def test_it_strips_one_pair_of_wrapping_quotes(self) -> None:
        self.assertEqual(clean_edited_caption(f'"{EDITED}"'), EDITED)

    def test_it_keeps_the_quotes_of_a_caption_that_is_itself_a_quotation(self) -> None:
        # Stripping here would silently change a caption whose content is a quoted phrase.
        quoted = 'A sign reading "OPEN" hangs in the window.'

        self.assertEqual(strip_wrapping_quotes(quoted), quoted)

    def test_an_empty_reply_cleans_to_nothing(self) -> None:
        self.assertEqual(clean_edited_caption("   \n  "), "")


class EditCaptionsRejectionTests(unittest.TestCase):
    def test_an_empty_reply_is_rejected(self) -> None:
        self.assertIsNotNone(edit_rejection_reason(ORIGINAL, "  "))

    def test_a_runaway_reply_is_rejected(self) -> None:
        self.assertIsNotNone(edit_rejection_reason(ORIGINAL, "word " * len(ORIGINAL)))

    def test_a_stub_reply_is_rejected(self) -> None:
        self.assertIsNotNone(edit_rejection_reason(ORIGINAL, "Yes."))

    def test_a_short_reply_that_is_still_a_caption_is_kept(self) -> None:
        # "shorten to one sentence" on a long caption legitimately collapses it; a bare
        # ratio floor would reject the edit for working. Do not remove this allowance.
        long_original = " ".join([ORIGINAL] * 12)
        shortened = "A woman walks along a wet street at night."

        self.assertGreater(len(shortened), MIN_EDITED_CAPTION_CHARS)
        self.assertLess(len(shortened), len(long_original) * 0.25)
        self.assertIsNone(edit_rejection_reason(long_original, shortened))

    def test_a_reply_at_the_bounds_is_kept(self) -> None:
        original = "x" * 100

        self.assertIsNone(edit_rejection_reason(original, "y" * 400))
        self.assertIsNone(edit_rejection_reason(original, "y" * 25))

    def test_an_ordinary_edit_is_kept(self) -> None:
        self.assertIsNone(edit_rejection_reason(ORIGINAL, EDITED))


class EditCaptionsValidationTests(unittest.TestCase):
    def test_a_blank_instruction_is_refused(self) -> None:
        with TempMediaFolder() as root:
            _captioned(root, "photo.png")

            with self.assertRaises(ValueError) as caught:
                validate_edit_captions_folder(root, instruction="   ")

        self.assertIn("instruction", str(caught.exception))

    def test_a_folder_with_no_media_is_refused(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaises(ValueError) as caught:
                validate_edit_captions_folder(root, instruction=INSTRUCTION)

        self.assertIn("No supported images or videos", str(caught.exception))


class EditCaptionsJobRunTests(unittest.TestCase):
    def test_it_writes_the_edited_caption(self) -> None:
        with TempMediaFolder() as root:
            media = _captioned(root, "photo.png")

            with patch("automation.edit_captions.edit_caption", return_value=EDITED):
                result = _run(root)

            self.assertEqual(_caption_text(media), EDITED)
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["results"][0]["description"], EDITED)

    def test_an_identical_reply_counts_unchanged_and_writes_nothing(self) -> None:
        with TempMediaFolder() as root:
            media = _captioned(root, "photo.png")
            before = media.with_suffix(".txt").stat().st_mtime_ns

            with patch("automation.edit_captions.edit_caption", return_value=f"  {ORIGINAL}  "):
                result = _run(root)

            self.assertEqual(result["stats"]["unchanged"], 1)
            self.assertEqual(result["stats"]["success"], 0)
            self.assertEqual(media.with_suffix(".txt").stat().st_mtime_ns, before)

    def test_a_captionless_file_never_reaches_the_model(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with patch("automation.edit_captions.edit_caption") as model:
                result = _run(root)

            model.assert_not_called()
            self.assertEqual(result["stats"]["no_caption"], 1)

    def test_a_rejected_reply_leaves_the_caption_alone_and_retries(self) -> None:
        with TempMediaFolder() as root:
            media = _captioned(root, "photo.png")

            with patch("automation.edit_captions.edit_caption", return_value="Yes.") as model:
                result = _run(root)

            self.assertEqual(_caption_text(media), ORIGINAL)
            self.assertEqual(result["stats"]["rejected"], 1)
            self.assertEqual(model.call_count, MAX_MODEL_ATTEMPTS)

    def test_a_rejection_that_clears_on_retry_succeeds(self) -> None:
        with TempMediaFolder() as root:
            media = _captioned(root, "photo.png")

            with patch(
                "automation.edit_captions.edit_caption",
                side_effect=["Yes.", "No.", EDITED],
            ) as model:
                result = _run(root)

            self.assertEqual(_caption_text(media), EDITED)
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(model.call_count, 3)

    def test_a_failed_request_counts_an_api_error(self) -> None:
        with TempMediaFolder() as root:
            media = _captioned(root, "photo.png")

            with patch("automation.edit_captions.edit_caption", return_value=None) as model:
                result = _run(root)

            self.assertEqual(_caption_text(media), ORIGINAL)
            self.assertEqual(result["stats"]["api_error"], 1)
            self.assertEqual(model.call_count, MAX_MODEL_ATTEMPTS)

    def test_it_honours_the_selection(self) -> None:
        with TempMediaFolder() as root:
            first = _captioned(root, "a.png")
            second = _captioned(root, "b.png")

            with patch("automation.edit_captions.edit_caption", return_value=EDITED):
                _run(root, selected_paths=[first])

            self.assertEqual(_caption_text(first), EDITED)
            self.assertEqual(_caption_text(second), ORIGINAL)

    def test_every_handled_file_counts_toward_processed(self) -> None:
        with TempMediaFolder() as root:
            _captioned(root, "a.png")
            _captioned(root, "b.png")
            _captioned(root, "c.png")
            write_media(root, "d.png")

            with patch(
                "automation.edit_captions.edit_caption",
                side_effect=[EDITED, ORIGINAL, "Yes.", "Yes.", "Yes."],
            ):
                result = _run(root)

            self.assertEqual(result["processed"], result["total"])
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["stats"]["unchanged"], 1)
            self.assertEqual(result["stats"]["rejected"], 1)
            self.assertEqual(result["stats"]["no_caption"], 1)

    def test_the_system_prompt_is_built_once_for_the_whole_run(self) -> None:
        # One identical system message per file keeps the server's prefix cache warm.
        with TempMediaFolder() as root:
            _captioned(root, "a.png")
            _captioned(root, "b.png")
            _captioned(root, "c.png")

            with (
                patch(
                    "automation.edit_captions.build_edit_system_prompt",
                    return_value="SYSTEM",
                ) as build,
                patch("automation.edit_captions.edit_caption", return_value=EDITED),
            ):
                _run(root)

            self.assertEqual(build.call_count, 1)


class EditCaptionsBackupTests(unittest.TestCase):
    def test_the_original_goes_to_the_backup_folder(self) -> None:
        with TempMediaFolder() as root:
            media = _captioned(root, "photo.png")

            with patch("automation.edit_captions.edit_caption", return_value=EDITED):
                _run(root, backup=True)

            self.assertEqual(_caption_text(media), EDITED)
            backed_up = root / ".backup" / "photo.txt"
            self.assertEqual(backed_up.read_text(encoding="utf-8-sig").strip(), ORIGINAL)

    def test_a_second_run_keeps_the_original_from_before_the_first_edit(self) -> None:
        # That first copy is the one worth restoring; burying it would defeat the undo.
        with TempMediaFolder() as root:
            _captioned(root, "photo.png")

            with patch("automation.edit_captions.edit_caption", return_value=EDITED):
                _run(root, backup=True)
            with patch("automation.edit_captions.edit_caption", return_value="Something else."):
                _run(root, backup=True)

            backed_up = root / ".backup" / "photo.txt"
            self.assertEqual(backed_up.read_text(encoding="utf-8-sig").strip(), ORIGINAL)

    def test_backup_off_creates_no_backup_folder(self) -> None:
        with TempMediaFolder() as root:
            _captioned(root, "photo.png")

            with patch("automation.edit_captions.edit_caption", return_value=EDITED):
                _run(root, backup=False)

            self.assertFalse((root / ".backup").exists())

    def test_a_failed_backup_leaves_the_caption_and_carries_on(self) -> None:
        # Writing the edit after failing to preserve the original would break the promise
        # the checkbox makes, for exactly the file the user would most want back.
        with TempMediaFolder() as root:
            first = _captioned(root, "a.png")
            second = _captioned(root, "b.png")
            real_copy = __import__("shutil").copy2
            calls: list[int] = []

            def flaky_copy(src, dst, *args, **kwargs):
                calls.append(1)
                if len(calls) == 1:
                    raise OSError("denied")
                return real_copy(src, dst, *args, **kwargs)

            with (
                patch("automation.edit_captions.shutil.copy2", side_effect=flaky_copy),
                patch("automation.edit_captions.edit_caption", return_value=EDITED),
            ):
                result = _run(root, backup=True)

            self.assertEqual(_caption_text(first), ORIGINAL)
            self.assertEqual(result["stats"]["write_error"], 1)
            # The run continued: one permission problem must not abandon the folder.
            self.assertEqual(_caption_text(second), EDITED)
            self.assertEqual(result["stats"]["success"], 1)

    def test_unchanged_and_captionless_files_are_not_backed_up(self) -> None:
        with TempMediaFolder() as root:
            _captioned(root, "a.png")
            write_media(root, "b.png")

            with patch("automation.edit_captions.edit_caption", return_value=ORIGINAL):
                _run(root, backup=True)

            self.assertEqual(list((root / ".backup").glob("*.txt")), [])

    def test_an_unusable_backup_folder_fails_the_whole_job(self) -> None:
        with TempMediaFolder() as root:
            _captioned(root, "photo.png")

            with patch("pathlib.Path.mkdir", side_effect=OSError("denied")):
                with self.assertRaises(ValueError) as caught:
                    _run(root, backup=True)

        self.assertIn(".backup", str(caught.exception))


class EditCaptionsCancellationTests(unittest.TestCase):
    def test_cancelling_leaves_the_remaining_files_untouched(self) -> None:
        with TempMediaFolder() as root:
            first = _captioned(root, "a.png")
            second = _captioned(root, "c.png")
            third = _captioned(root, "d.png")
            seen: list[int] = []

            def cancel_after_one() -> bool:
                return len(seen) >= 1

            def model(*_args: object, **_kwargs: object) -> str:
                seen.append(1)
                return EDITED

            with patch("automation.edit_captions.edit_caption", side_effect=model):
                result = _run(root, backup=True, should_cancel=cancel_after_one)

            self.assertEqual(_caption_text(second), ORIGINAL)
            self.assertEqual(_caption_text(third), ORIGINAL)
            self.assertGreater(result["stats"]["cancelled"], 0)
            # Nothing was backed up for files that were never edited either.
            self.assertNotIn("c.txt", [p.name for p in (root / ".backup").glob("*.txt")])
            self.assertIn(first.name, {p.name for p in root.glob("*.png")})

    def test_cancelling_between_the_model_and_the_write_leaves_that_file_alone(self) -> None:
        # This is why the backup sits after the cancel re-check rather than before it.
        with TempMediaFolder() as root:
            media = _captioned(root, "photo.png")
            cancelled: list[int] = []

            def cancel_once_the_model_answered() -> bool:
                return bool(cancelled)

            def model(*_args: object, **_kwargs: object) -> str:
                cancelled.append(1)
                return EDITED

            with patch("automation.edit_captions.edit_caption", side_effect=model):
                _run(root, backup=True, should_cancel=cancel_once_the_model_answered)

            self.assertEqual(_caption_text(media), ORIGINAL)
            self.assertEqual(list((root / ".backup").glob("*.txt")), [])


class EditCaptionsRequestTests(unittest.TestCase):
    def test_the_request_carries_no_media_part(self) -> None:
        # The whole point of this job: the caption is the only thing that is sent.
        client, captured = _make_fake_edit_client()

        edit_caption(client, build_edit_system_prompt(INSTRUCTION), ORIGINAL, mode="thinking")

        user_message = captured["messages"][1]
        self.assertEqual(user_message["role"], "user")
        self.assertIsInstance(user_message["content"], str)
        self.assertIn(ORIGINAL, user_message["content"])

    def test_instruct_mode_prefills_the_empty_think_block(self) -> None:
        client, captured = _make_fake_edit_client()

        edit_caption(client, "SYSTEM", ORIGINAL, mode="instruct")

        messages = captured["messages"]
        self.assertEqual(len(messages), 3)
        self.assertEqual(messages[2]["content"], INSTRUCT_THINK_PREFILL)
        self.assertEqual(captured["temperature"], 0.7)
        self.assertEqual(captured["top_p"], 0.8)
        self.assertEqual(captured["presence_penalty"], 1.5)

    def test_thinking_mode_sends_the_reasoning_kwargs(self) -> None:
        client, captured = _make_fake_edit_client()

        edit_caption(client, "SYSTEM", ORIGINAL, mode="thinking", effort="low")

        self.assertEqual(len(captured["messages"]), 2)
        self.assertEqual(captured["extra_body"]["chat_template_kwargs"]["reasoning_effort"], "low")


if __name__ == "__main__":
    unittest.main()
