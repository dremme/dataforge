from __future__ import annotations

import unittest

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.check_caption_rules import (
    run_check_caption_rules_job,
    validate_check_caption_rules_folder,
)
from captions import issue_file_path, load_issue_summary
from constants import CAPTION_RULES_FILENAME, MAX_RULE_FINDINGS
from testing_fixtures import (
    TempMediaFolder,
    write_issue_sidecar,
    write_media,
    write_txt_caption,
)

FLAG_RULES = "flag:\n  - match: [float*]\n    note: check the subject is off the ground\n"


def _write_rules(folder, text: str = FLAG_RULES):
    rules = folder / CAPTION_RULES_FILENAME
    rules.write_text(text, encoding="utf-8")
    return rules


class ValidateCheckCaptionRulesTests(unittest.TestCase):
    def test_requires_a_rule_file(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaisesRegex(ValueError, CAPTION_RULES_FILENAME):
                validate_check_caption_rules_folder(root)

    def test_reports_a_broken_rule_file(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            _write_rules(root, "colour: blue\n")

            with self.assertRaisesRegex(ValueError, "colour: unknown setting"):
                validate_check_caption_rules_folder(root)

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)

            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_check_caption_rules_folder(root)

    def test_accepts_a_rule_file_from_a_parent_folder(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)
            child = root / "portraits"
            child.mkdir()
            write_media(child, "photo.png")

            validate_check_caption_rules_folder(child)


class CheckCaptionRulesJobTests(unittest.TestCase):
    def test_records_rule_hits_and_counts_the_flagged_files(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)
            flagged = write_media(root, "balloon.png")
            clean = write_media(root, "bridge.png")
            write_txt_caption(flagged, "A balloon floating over the hills.")
            write_txt_caption(clean, "A stone bridge over a river.")

            result = run_check_caption_rules_job(root)

            self.assertEqual(
                load_issue_summary(flagged).rules,
                ['"floating": check the subject is off the ground'],
            )
            self.assertFalse(issue_file_path(clean).exists())
            self.assertEqual(result["stats"]["success"], 2)
            self.assertEqual(result["stats"]["issues_found"], 1)
            self.assertEqual(result["processed"], 2)

    def test_keeps_the_model_findings_beside_the_rule_hits(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)
            media = write_media(root, "balloon.png")
            write_txt_caption(media, "A balloon floating over the hills.")
            write_issue_sidecar(media, "The caption omits the river.")

            run_check_caption_rules_job(root)

            self.assertEqual(
                load_issue_summary(media),
                (
                    ["The caption omits the river."],
                    ['"floating": check the subject is off the ground'],
                    True,
                ),
            )

    def test_a_fixed_caption_clears_its_old_rule_hits(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)
            media = write_media(root, "balloon.png")
            write_txt_caption(media, "A balloon resting on the grass.")
            write_issue_sidecar(media, rules=('"floating": old hit',))

            run_check_caption_rules_job(root)

            self.assertFalse(issue_file_path(media).exists())

    def test_an_uncaptioned_file_is_skipped_and_loses_stale_rule_hits(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)
            media = write_media(root, "balloon.png")
            write_issue_sidecar(media, rules=('"floating": old hit',))

            result = run_check_caption_rules_job(root)

            self.assertFalse(issue_file_path(media).exists())
            self.assertEqual(result["stats"]["no_caption"], 1)
            self.assertEqual(result["results"][0]["status"], "no_caption")

    def test_only_the_selected_files_are_checked(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)
            selected = write_media(root, "one.png")
            unselected = write_media(root, "two.png")
            write_txt_caption(selected, "A kite floating in the wind.")
            write_txt_caption(unselected, "A kite floating in the wind.")

            result = run_check_caption_rules_job(root, selected_paths=[selected])

            self.assertEqual(result["total"], 1)
            self.assertTrue(issue_file_path(selected).exists())
            self.assertFalse(issue_file_path(unselected).exists())

    def test_the_rule_hits_are_capped_with_a_summary(self) -> None:
        with TempMediaFolder() as root:
            terms = [f"term{index}" for index in range(MAX_RULE_FINDINGS + 1)]
            _write_rules(root, f"flag:\n  - match: [{', '.join(terms)}]\n")
            media = write_media(root, "photo.png")
            write_txt_caption(media, " ".join(terms))

            run_check_caption_rules_job(root)

            rules = load_issue_summary(media).rules
            self.assertEqual(len(rules), MAX_RULE_FINDINGS)
            self.assertEqual(rules[-1], "And 2 more rule hits.")

    def test_the_result_row_carries_the_hits(self) -> None:
        with TempMediaFolder() as root:
            _write_rules(root)
            media = write_media(root, "balloon.png")
            write_txt_caption(media, "A balloon floating over the hills.")

            result = run_check_caption_rules_job(root)

            self.assertEqual(
                result["results"][0]["description"],
                '"floating": check the subject is off the ground',
            )


if __name__ == "__main__":
    unittest.main()
