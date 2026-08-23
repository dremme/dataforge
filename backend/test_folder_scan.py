"""Unit tests for the shared directory scan and the stat-keyed sidecar cache."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import os
import unittest

from caption_cache import clear_caption_cache_for_tests
from captions import caption_summary_from_sidecar, issue_file_path, issue_summary_from_sidecar
from folder_scan import get_media_type, scan_folder
from media_listing import list_media_in_folder
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_issue_sidecar,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)


class MediaTypeTests(unittest.TestCase):
    def test_classifies_each_supported_extension(self) -> None:
        with TempMediaFolder() as root:
            self.assertEqual(get_media_type(write_media(root, "photo.png")), "image")
            self.assertEqual(get_media_type(write_mp4_video(root, "clip.mp4")), "video")
            # Its own type rather than "video": the frontend picks the element from
            # this, and a GIF needs an <img>.
            self.assertEqual(get_media_type(write_gif(root, "loop.gif")), "gif")

    def test_classifies_every_image_format(self) -> None:
        with TempMediaFolder() as root:
            for name in ("photo.jpg", "photo.jpeg", "photo.png", "photo.webp", "photo.bmp"):
                with self.subTest(name=name):
                    self.assertEqual(get_media_type(root / name), "image")

    def test_classifies_every_video_container(self) -> None:
        with TempMediaFolder() as root:
            for name in (
                "clip.mp4",
                "clip.avi",
                "clip.mov",
                "clip.mkv",
                "clip.wmv",
                "clip.m4v",
                "clip.flv",
            ):
                with self.subTest(name=name):
                    self.assertEqual(get_media_type(root / name), "video")

    def test_classification_ignores_case(self) -> None:
        with TempMediaFolder() as root:
            self.assertEqual(get_media_type(write_gif(root, "LOOP.GIF")), "gif")
            self.assertEqual(get_media_type(root / "CLIP.MKV"), "video")
            self.assertEqual(get_media_type(root / "PHOTO.WEBP"), "image")

    def test_returns_none_for_unsupported_extensions(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(get_media_type(root / "notes.md"))
            # Vector, so nothing that decodes pixels here could read it.
            self.assertIsNone(get_media_type(root / "logo.svg"))
            # Audio-only files are deliberately out of scope.
            for name in ("track.mp3", "track.wav", "track.flac", "track.ogg"):
                with self.subTest(name=name):
                    self.assertIsNone(get_media_type(root / name))


class FolderScanTests(unittest.TestCase):
    def test_returns_none_for_unreadable_folder(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(scan_folder(root / "does-not-exist"))

    def test_a_gif_lands_in_the_media_list(self) -> None:
        with TempMediaFolder() as root:
            write_gif(root, "loop.gif")

            scan = scan_folder(root)

            assert scan is not None
            self.assertEqual([entry.name for entry in scan.media], ["loop.gif"])

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

    def test_listing_carries_dimensions_for_every_media_type(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png", width=800, height=600)
            write_gif(root, "loop.gif", width=320, height=240)
            write_mp4_video(root, "clip.mp4", width=1920, height=1080)

            by_name = {item["name"]: item for item in list_media_in_folder(root)}
            sizes = {name: (item["width"], item["height"]) for name, item in by_name.items()}

            self.assertEqual(sizes["alpha.png"], (800, 600))
            self.assertEqual(sizes["loop.gif"], (320, 240))
            self.assertEqual(sizes["clip.mp4"], (1920, 1080))
            self.assertIsNone(by_name["alpha.png"]["duration"])
            self.assertIsNone(by_name["loop.gif"]["duration"])
            self.assertEqual(by_name["clip.mp4"]["duration"], 10.0)

    def test_listing_leaves_dimensions_empty_when_they_cannot_be_read(self) -> None:
        with TempMediaFolder() as root:
            (root / "headerless.mp4").write_bytes(b"\x00\x00\x00\x10ftypisom\x00\x00\x02\x00")
            (root / "truncated.png").write_bytes(b"\x89PNG\r\n\x1a\n")

            by_name = {item["name"]: item for item in list_media_in_folder(root)}

            for name in ("headerless.mp4", "truncated.png"):
                self.assertIsNone(by_name[name]["width"])
                self.assertIsNone(by_name[name]["height"])

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

            first = caption_summary_from_sidecar(caption, stat.st_mtime_ns, stat.st_size)
            # Rewriting the file without touching the cache key must not be seen:
            # the cache is only allowed to be stale when the stat signature matches.
            caption.write_text("Second caption.", encoding="utf-8")
            os.utime(caption, ns=(stat.st_mtime_ns, stat.st_mtime_ns))
            second = caption_summary_from_sidecar(caption, stat.st_mtime_ns, stat.st_size)

            self.assertEqual(first[0], "First caption.")
            self.assertEqual(second, first)

    def test_new_mtime_busts_the_cache(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            caption = write_txt_caption(media, "First caption.")
            first_stat = caption.stat()
            caption_summary_from_sidecar(caption, first_stat.st_mtime_ns, first_stat.st_size)

            write_txt_caption(media, "A rather different caption.")
            second_stat = caption.stat()
            second = caption_summary_from_sidecar(
                caption, second_stat.st_mtime_ns, second_stat.st_size
            )

            self.assertEqual(second[0], "A rather different caption.")

    def test_issue_fixes_are_copied_per_call(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            write_issue_sidecar(media, 'Replace "a" with "b".')
            issue_path = issue_file_path(media)
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
