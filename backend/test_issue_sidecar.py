from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import json
import unittest

from captions import (
    delete_issue_file,
    issue_file_path,
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


class SaveIssueFixesTests(unittest.TestCase):
    """Verify-captions is the only writer; duplicates live in their own sidecar."""

    def test_writes_the_fixes_it_is_given(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            save_issue_fixes(media, ['Remove "dusk".'])

            payload = json.loads(issue_file_path(media).read_text(encoding="utf-8"))
            self.assertEqual(payload, {"fixes": ['Remove "dusk".']})

    def test_caps_the_list(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            save_issue_fixes(media, [f"Fix {index}." for index in range(MAX_ISSUE_FIXES + 2)])

            self.assertEqual(len(load_issue_summary(media)[0]), MAX_ISSUE_FIXES)

    def test_removes_the_sidecar_when_there_are_no_fixes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, 'Remove "dusk".')

            save_issue_fixes(media, [])

            self.assertFalse(issue_file_path(media).exists())

    def test_writes_nothing_when_there_was_no_sidecar_to_begin_with(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            save_issue_fixes(media, [])

            self.assertFalse(issue_file_path(media).exists())


class SidecarNamingTests(unittest.TestCase):
    """One sidecar per media file, not per stem, so ``clip.mp4`` and ``clip.png`` cannot share one."""

    def test_the_name_carries_the_media_extension(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "clip.png")

            self.assertEqual(issue_file_path(media).name, "clip.png.issue.json")

    def test_two_media_under_one_stem_keep_their_own_findings(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "clip.png")
            second = write_media(root, "clip.jpg")

            save_issue_fixes(first, ["The caption omits the mountains."])
            save_issue_fixes(second, ["The caption says dusk, the sky is bright."])

            self.assertEqual(load_issue_summary(first)[0], ["The caption omits the mountains."])
            self.assertEqual(
                load_issue_summary(second)[0], ["The caption says dusk, the sky is bright."]
            )

    def test_clearing_one_leaves_the_other_alone(self) -> None:
        """The bug itself: the clean file's clear took the flagged file's findings."""
        with TempMediaFolder() as root:
            flagged = write_media(root, "clip.png")
            clean = write_media(root, "clip.jpg")
            save_issue_fixes(flagged, ["The caption omits the mountains."])

            save_issue_fixes(clean, [])

            self.assertEqual(
                load_issue_summary(flagged), (["The caption omits the mountains."], True)
            )

    def test_deleting_removes_only_this_file_findings(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "clip.png")
            stem_sharer = write_media(root, "clip.jpg")
            save_issue_fixes(media, ["The caption omits the mountains."])
            save_issue_fixes(stem_sharer, ["The caption says dusk, the sky is bright."])

            delete_issue_file(media)

            self.assertFalse(issue_file_path(media).exists())
            self.assertTrue(issue_file_path(stem_sharer).is_file())


if __name__ == "__main__":
    unittest.main()
