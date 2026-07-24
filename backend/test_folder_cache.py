"""Unit tests for folder summary cache."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from unittest.mock import patch

from media_listing import (
    clear_folder_summary_cache_for_tests,
    folder_summary_fingerprint,
    summarize_folder_contents,
)
from testing_fixtures import TempMediaFolder, write_media, write_txt_caption


class FolderSummaryCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_folder_summary_cache_for_tests()

    def tearDown(self) -> None:
        clear_folder_summary_cache_for_tests()

    def test_reuses_cached_summary_when_fingerprint_is_unchanged(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            uncached_calls = {"count": 0}
            original = summarize_folder_contents.__globals__["_summarize_folder_contents_uncached"]

            def counting_uncached(folder):
                uncached_calls["count"] += 1
                return original(folder)

            with patch(
                "media_listing._summarize_folder_contents_uncached",
                side_effect=counting_uncached,
            ):
                first = summarize_folder_contents(root)
                second = summarize_folder_contents(root)

            self.assertEqual(first, second)
            self.assertEqual(uncached_calls["count"], 1)

    def test_invalidates_cache_when_sidecar_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            first = summarize_folder_contents(root)
            write_txt_caption(media, "New caption.")
            second = summarize_folder_contents(root)

            self.assertEqual(first["captioned_count"], 0)
            self.assertEqual(second["captioned_count"], 1)
            self.assertEqual(first["issue_count"], 0)
            self.assertIsNotNone(folder_summary_fingerprint(root))

    def test_counts_issue_sidecars(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            first = summarize_folder_contents(root)
            media.with_suffix(".issue.json").write_text(
                '{"correct": false, "issues": "Mismatch.", "suggestions": "None"}',
                encoding="utf-8",
            )
            second = summarize_folder_contents(root)

            self.assertEqual(first["issue_count"], 0)
            self.assertEqual(second["issue_count"], 1)

    def test_invalidates_cache_when_media_file_changes(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png", width=64)
            uncached_calls = {"count": 0}
            original = summarize_folder_contents.__globals__["_summarize_folder_contents_uncached"]

            def counting_uncached(folder):
                uncached_calls["count"] += 1
                return original(folder)

            with patch(
                "media_listing._summarize_folder_contents_uncached",
                side_effect=counting_uncached,
            ):
                first = summarize_folder_contents(root)
                write_media(root, "alpha.png", width=96)
                second = summarize_folder_contents(root)

            self.assertEqual(first["file_count"], 1)
            self.assertEqual(second["file_count"], 1)
            self.assertEqual(uncached_calls["count"], 2)


if __name__ == "__main__":
    unittest.main()
