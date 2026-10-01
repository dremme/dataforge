from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from unittest.mock import patch

import media_listing
from media_listing import clear_folder_summary_cache_for_tests, summarize_folder_contents
from testing_fixtures import (
    TempMediaFolder,
    write_issue_sidecar,
    write_media,
    write_txt_caption,
)


def _counting(name: str):
    return patch.object(media_listing, name, wraps=getattr(media_listing, name))


class FolderSummaryCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_folder_summary_cache_for_tests()
        self.addCleanup(clear_folder_summary_cache_for_tests)

    def test_reuses_cached_summary_when_fingerprint_is_unchanged(self) -> None:
        with TempMediaFolder() as root, _counting("_summarize_scan_uncached") as uncached:
            write_media(root, "alpha.png")
            first = summarize_folder_contents(root)
            second = summarize_folder_contents(root)

        self.assertEqual(first, second)
        self.assertEqual(uncached.call_count, 1)

    def test_a_cache_miss_counts_the_same_walk_it_fingerprints(self) -> None:
        with TempMediaFolder() as root, _counting("scan_folder") as scan:
            write_media(root, "alpha.png")
            summarize_folder_contents(root)

        self.assertEqual(scan.call_count, 1)

    def test_invalidates_cache_when_a_sidecar_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            first = summarize_folder_contents(root)
            write_txt_caption(media, "New caption.")
            write_issue_sidecar(media, 'Replace "a lake" with "a harbour".')
            second = summarize_folder_contents(root)

        self.assertEqual((first["captioned_count"], first["issue_count"]), (0, 0))
        self.assertEqual((second["captioned_count"], second["issue_count"]), (1, 1))

    def test_invalidates_cache_when_media_file_changes(self) -> None:
        with TempMediaFolder() as root, _counting("_summarize_scan_uncached") as uncached:
            write_media(root, "alpha.png", width=64)
            first = summarize_folder_contents(root)
            write_media(root, "alpha.png", width=96)
            second = summarize_folder_contents(root)

        self.assertEqual(first["file_count"], 1)
        self.assertEqual(second["file_count"], 1)
        self.assertEqual(uncached.call_count, 2)


if __name__ == "__main__":
    unittest.main()
