"""Unit tests for the shared directory scan and the stat-keyed sidecar cache."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import os
import unittest

from caption_cache import clear_caption_cache_for_tests
from captions import caption_summary_from_sidecar, issue_summary_from_sidecar
from folder_scan import scan_folder
from media_listing import list_media_in_folder
from testing_fixtures import (
    TempMediaFolder,
    write_issue_sidecar,
    write_media,
    write_sysprompt,
    write_txt_caption,
)


class FolderScanTests(unittest.TestCase):
    def test_returns_none_for_unreadable_folder(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(scan_folder(root / "does-not-exist"))

    def test_separates_media_dirs_sidecars_and_sysprompt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            write_txt_caption(media, "A caption.")
            write_sysprompt(root, "Describe scenes.")
            (root / "Album").mkdir()
            (root / ".git").mkdir()
            (root / "notes.md").write_text("ignore", encoding="utf-8")

            scan = scan_folder(root)

            assert scan is not None
            self.assertEqual([entry.name for entry in scan.media], ["alpha.png"])
            self.assertEqual([entry.name for entry in scan.dirs], ["Album"])
            self.assertIsNotNone(scan.sysprompt)
            self.assertIn("alpha.txt", scan.files)
            self.assertIn("notes.md", scan.files)

    def test_media_is_sorted_case_insensitively(self) -> None:
        with TempMediaFolder() as root:
            for name in ("Zebra.png", "apple.png", "Mango.png"):
                write_media(root, name)

            scan = scan_folder(root)

            assert scan is not None
            self.assertEqual(
                [entry.name for entry in scan.media],
                ["apple.png", "Mango.png", "Zebra.png"],
            )

    def test_sidecar_lookup_matches_stat_on_disk(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            caption = write_txt_caption(media, "A caption.")

            scan = scan_folder(root)

            assert scan is not None
            entry = scan.sidecar("alpha", ".txt")
            self.assertIsNotNone(entry)
            assert entry is not None
            self.assertEqual(entry.size, caption.stat().st_size)
            self.assertEqual(entry.mtime_ns, caption.stat().st_mtime_ns)
            self.assertIsNone(scan.sidecar("alpha", ".json"))


class ScanBackedListingTests(unittest.TestCase):
    def test_listing_reports_caption_and_issue_metadata(self) -> None:
        with TempMediaFolder() as root:
            captioned = write_media(root, "captioned.png")
            write_txt_caption(captioned, "Has text.")
            write_issue_sidecar(captioned, 'Replace "a" with "b".')
            write_media(root, "plain.png")

            by_name = {item["name"]: item for item in list_media_in_folder(root)}

            self.assertEqual(sorted(by_name), ["captioned.png", "plain.png"])
            self.assertEqual(by_name["captioned.png"]["description"], "Has text.")
            self.assertEqual(by_name["captioned.png"]["caption_status"], "text")
            self.assertEqual(by_name["captioned.png"]["caption_file_type"], "txt")
            self.assertTrue(by_name["captioned.png"]["has_issue_file"])
            self.assertEqual(
                by_name["captioned.png"]["issue_fixes"],
                ['Replace "a" with "b".'],
            )
            self.assertFalse(by_name["plain.png"]["has_description"])
            self.assertEqual(by_name["plain.png"]["caption_status"], "none")
            self.assertFalse(by_name["plain.png"]["has_issue_file"])

    def test_listing_always_carries_size_and_modified_at(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")

            item = list_media_in_folder(root)[0]

            self.assertEqual(item["size"], (root / "alpha.png").stat().st_size)
            self.assertTrue(item["modified_at"])

    def test_listing_is_empty_for_unreadable_folder(self) -> None:
        with TempMediaFolder() as root:
            self.assertEqual(list_media_in_folder(root / "missing"), [])


class CaptionCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def tearDown(self) -> None:
        clear_caption_cache_for_tests()

    def test_reuses_parsed_caption_while_stat_is_unchanged(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            caption = write_txt_caption(media, "First caption.")
            stat = caption.stat()

            first = caption_summary_from_sidecar(caption, "txt", stat.st_mtime_ns, stat.st_size)
            # Rewriting the file without touching the cache key must not be seen:
            # the cache is only allowed to be stale when the stat signature matches.
            caption.write_text("Second caption.", encoding="utf-8")
            os.utime(caption, ns=(stat.st_mtime_ns, stat.st_mtime_ns))
            second = caption_summary_from_sidecar(caption, "txt", stat.st_mtime_ns, stat.st_size)

            self.assertEqual(first[0], "First caption.")
            self.assertEqual(second, first)

    def test_new_mtime_busts_the_cache(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            caption = write_txt_caption(media, "First caption.")
            first_stat = caption.stat()
            caption_summary_from_sidecar(caption, "txt", first_stat.st_mtime_ns, first_stat.st_size)

            write_txt_caption(media, "A rather different caption.")
            second_stat = caption.stat()
            second = caption_summary_from_sidecar(
                caption, "txt", second_stat.st_mtime_ns, second_stat.st_size
            )

            self.assertEqual(second[0], "A rather different caption.")

    def test_issue_fixes_are_copied_per_call(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            write_issue_sidecar(media, 'Replace "a" with "b".')
            issue_path = media.with_suffix(".issue.json")
            stat = issue_path.stat()

            first, _ = issue_summary_from_sidecar(issue_path, stat.st_mtime_ns, stat.st_size)
            first.append("mutated")
            second, has_issue_file = issue_summary_from_sidecar(
                issue_path, stat.st_mtime_ns, stat.st_size
            )

            self.assertTrue(has_issue_file)
            self.assertEqual(second, ['Replace "a" with "b".'])


if __name__ == "__main__":
    unittest.main()
