"""Unit tests for reading and writing caption issue sidecars."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import json
import unittest

from captions import (
    is_duplicate_fix,
    issue_file_path,
    load_issue_fix_groups,
    load_issue_summary,
    save_issue_fixes,
)
from constants import MAX_ISSUE_FIXES
from testing_fixtures import TempMediaFolder, write_issue_sidecar, write_media


class LoadIssueSummaryTests(unittest.TestCase):
    def test_reports_nothing_when_no_sidecar_exists(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            self.assertEqual(load_issue_summary(media), ([], False))

    def test_reads_the_fixes_array(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, 'Replace "a blue lake" with "a harbour".', 'Remove "dusk".')

            self.assertEqual(
                load_issue_summary(media),
                (['Replace "a blue lake" with "a harbour".', 'Remove "dusk".'], True),
            )

    def test_caps_the_fix_list(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, *[f"Fix {index}." for index in range(MAX_ISSUE_FIXES + 2)])

            fixes, has_issue_file = load_issue_summary(media)

            self.assertEqual(len(fixes), MAX_ISSUE_FIXES)
            self.assertTrue(has_issue_file)

    def test_superseded_sidecars_read_as_broken_rather_than_resolved(self) -> None:
        """The pre-fixes format is not translated: a re-run of the job rewrites it."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            issue_file_path(media).write_text(
                '{"correct": false, "issues": "Wrong lake.", "suggestions": "Say harbour."}',
                encoding="utf-8",
            )

            self.assertEqual(load_issue_summary(media), ([], True))

    def test_unreadable_sidecars_read_as_broken(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            issue_file_path(media).write_text("{not json", encoding="utf-8")

            self.assertEqual(load_issue_summary(media), ([], True))


class IssueFixOwnershipTests(unittest.TestCase):
    """Two jobs share one sidecar, so each has to find its own fixes in it."""

    def test_recognises_duplicate_findings_by_prefix(self) -> None:
        self.assertTrue(is_duplicate_fix("Duplicate of copy.png."))
        self.assertTrue(is_duplicate_fix("Near-duplicate of copy.png."))
        self.assertFalse(is_duplicate_fix('Replace "blue" with "red".'))

    def test_splits_a_sidecar_into_its_two_groups(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, "Duplicate of copy.png.", 'Remove "dusk".')

            self.assertEqual(
                load_issue_fix_groups(media),
                (["Duplicate of copy.png."], ['Remove "dusk".']),
            )

    def test_splits_a_missing_sidecar_into_two_empty_groups(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            self.assertEqual(load_issue_fix_groups(media), ([], []))


class SaveIssueFixesTests(unittest.TestCase):
    def test_writes_duplicate_findings_before_caption_findings(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            save_issue_fixes(
                media,
                duplicate_fixes=["Duplicate of copy.png."],
                caption_fixes=['Remove "dusk".'],
            )

            payload = json.loads(issue_file_path(media).read_text(encoding="utf-8"))
            self.assertEqual(payload, {"fixes": ["Duplicate of copy.png.", 'Remove "dusk".']})

    def test_caps_the_merged_list_by_cutting_caption_findings(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            save_issue_fixes(
                media,
                duplicate_fixes=["Duplicate of copy.png."],
                caption_fixes=[f"Fix {index}." for index in range(MAX_ISSUE_FIXES)],
            )

            fixes = load_issue_summary(media)[0]
            self.assertEqual(len(fixes), MAX_ISSUE_FIXES)
            self.assertEqual(fixes[0], "Duplicate of copy.png.")

    def test_removes_the_sidecar_when_both_groups_are_empty(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, "Duplicate of copy.png.")

            save_issue_fixes(media, duplicate_fixes=[], caption_fixes=[])

            self.assertFalse(issue_file_path(media).exists())

    def test_writes_nothing_when_there_was_no_sidecar_to_begin_with(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            save_issue_fixes(media, duplicate_fixes=[], caption_fixes=[])

            self.assertFalse(issue_file_path(media).exists())

    def test_a_surviving_group_keeps_the_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, "Duplicate of copy.png.", 'Remove "dusk".')

            duplicate_fixes, _caption_fixes = load_issue_fix_groups(media)
            save_issue_fixes(media, duplicate_fixes=duplicate_fixes, caption_fixes=[])

            self.assertEqual(load_issue_summary(media)[0], ["Duplicate of copy.png."])


if __name__ == "__main__":
    unittest.main()
