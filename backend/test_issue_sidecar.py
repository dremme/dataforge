"""Unit tests for reading caption issue sidecars."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from captions import issue_file_path, load_issue_summary
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


if __name__ == "__main__":
    unittest.main()
