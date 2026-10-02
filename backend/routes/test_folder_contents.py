from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from automation.backup_captions import run_backup_captions_job
from captions import issue_file_path
from constants import LAST_FOLDER_KEY, STAGING_DIR_NAME
from db import get_preference, set_preference
from folder_fingerprint import compute_folder_fingerprint
from media_listing import clear_folder_summary_cache_for_tests
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    write_caption_rules,
    write_gif,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)


def _listing(folder: Path) -> dict:
    response = client.get(f"/api/folders/contents?path={quote(str(folder))}")
    assert response.status_code == 200, response.text
    return response.json()


def _items_by_name(folder: Path) -> dict[str, dict]:
    return {item["name"]: item for item in _listing(folder)["items"]}


class FolderContentsEndpointTests(unittest.TestCase):
    def test_lists_media_with_caption_metadata(self) -> None:
        with TempMediaFolder() as root:
            captioned = write_media(root, "captioned.png")
            write_txt_caption(captioned, "Has text.")
            write_media(root, "plain.png")

            payload = _listing(root)

        self.assertEqual(payload["path"], str(root.resolve()))
        self.assertEqual(payload["item_count"], 2)
        self.assertFalse(payload["has_sysprompt"])
        by_name = {item["name"]: item for item in payload["items"]}
        self.assertTrue(by_name["captioned.png"]["has_description"])
        self.assertEqual(by_name["captioned.png"]["caption_status"], "text")
        self.assertFalse(by_name["plain.png"]["has_description"])
        self.assertEqual(by_name["plain.png"]["caption_status"], "none")

    def test_includes_subfolders_breadcrumbs_and_navigation_fields(self) -> None:
        with TempMediaFolder() as root:
            child = root / "album"
            child.mkdir()
            captioned = write_media(child, "done.png")
            write_txt_caption(captioned, "Captioned.")
            write_media(child, "pending.png")
            (child / "nested").mkdir()
            (root / ".git").mkdir()

            payload = _listing(root)
            stats = client.get(f"/api/folders/subfolder-stats?path={quote(str(root))}")

        self.assertEqual(payload["parent"], str(root.parent.resolve()))
        self.assertTrue(payload["home"])
        self.assertEqual(payload["breadcrumbs"][-1]["name"], root.name)
        self.assertEqual(payload["subfolder_count"], 1)

        # Counts are deferred to /api/folders/subfolder-stats so the grid can render first.
        album = payload["subfolders"][0]
        self.assertEqual(album["name"], "album")
        self.assertIsNone(album["file_count"])
        self.assertIsNone(album["captioned_count"])

        self.assertEqual(stats.status_code, 200)
        counted = stats.json()["subfolders"][0]
        self.assertEqual(counted["path"], album["path"])
        self.assertEqual(counted["file_count"], 2)
        self.assertEqual(counted["captioned_count"], 1)

    def test_lists_video_without_reading_its_header(self) -> None:
        # The listing reports what the directory scan already knows; nothing parses a video.
        with TempMediaFolder() as root:
            write_mp4_video(root, sample_count=120, timescale=30_000, sample_delta=1_000)

            item = _listing(root)["items"][0]

        self.assertEqual(item["media_type"], "video")
        self.assertNotIn("fps", item)

    def test_reports_whether_an_edited_video_can_still_be_reverted(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "plain.mp4")
            write_mp4_video(root, "edited.mp4")
            (root / "edited.mp4.bak").write_bytes(b"pristine-original")

            by_name = _items_by_name(root)

        self.assertEqual(sorted(by_name), ["edited.mp4", "plain.mp4"])
        self.assertTrue(by_name["edited.mp4"]["has_backup"])
        self.assertFalse(by_name["plain.mp4"]["has_backup"])

    def test_lists_gif_without_decoding_its_frames(self) -> None:
        # Walking each GIF's frames here would turn opening a folder into hundreds of decodes.
        with TempMediaFolder() as root:
            write_gif(root, "loop.gif", frames=8)

            with patch("gif_frames.gif_frame_count") as count:
                by_name = _items_by_name(root)

        count.assert_not_called()
        self.assertIn("loop.gif", by_name)

    def test_skips_non_media_files(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            (root / "notes.txt").write_text("ignore me", encoding="utf-8")
            write_caption_rules(root, "repeated_phrases: 4\n")

            self.assertEqual(list(_items_by_name(root)), ["alpha.png"])

    def test_reports_caption_backup_presence(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A plain caption.")

            before = _listing(root)
            run_backup_captions_job(root)
            after = _listing(root)

        self.assertFalse(before["has_caption_backup"])
        self.assertTrue(after["has_caption_backup"])

    def test_defaults_to_home_without_path_or_saved_folder(self) -> None:
        set_preference(LAST_FOLDER_KEY, "")

        response = client.get("/api/folders/contents")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["path"])

    def test_remembers_last_opened_folder(self) -> None:
        with TempMediaFolder() as root:
            _listing(root)

            second = client.get("/api/folders/contents")

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["path"], str(root.resolve()))
        self.assertEqual(get_preference(LAST_FOLDER_KEY), str(root.resolve()))

    def test_returns_404_for_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            for route in ("contents", "subfolder-stats"):
                with self.subTest(route=route):
                    response = client.get(f"/api/folders/{route}?path={quote(str(missing))}")
                    self.assertEqual(response.status_code, 404)

    def test_returns_400_when_path_is_a_file(self) -> None:
        with TempMediaFolder() as root:
            file_path = root / "file.txt"
            file_path.write_text("x", encoding="utf-8")

            response = client.get(f"/api/folders/contents?path={quote(str(file_path))}")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Path is not a directory")

    def test_reports_the_folder_own_sysprompt_and_whether_one_applies(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe scenes in detail.")
            child = root / "portraits"
            child.mkdir()

            own = _listing(root)
            inherited = _listing(child)

        self.assertEqual(own["items"], [])
        self.assertTrue(own["has_sysprompt"])
        self.assertTrue(own["sysprompt_applies"])
        self.assertFalse(inherited["has_sysprompt"])
        self.assertTrue(inherited["sysprompt_applies"])

    def test_an_empty_sysprompt_does_not_apply(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "  ")

            payload = _listing(root)

        self.assertTrue(payload["has_sysprompt"])
        self.assertFalse(payload["sysprompt_applies"])

    def test_reports_whether_the_folder_has_its_own_caption_rules(self) -> None:
        with TempMediaFolder() as root:
            child = root / "portraits"
            child.mkdir()
            write_caption_rules(root, "repeated_phrases: 4\n")

            own = _listing(root)
            inherited = _listing(child)

        self.assertTrue(own["has_caption_rules"])
        self.assertFalse(inherited["has_caption_rules"])

    def test_surfaces_superseded_issue_sidecars_as_broken(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "resolved.png")
            write_txt_caption(media, "A mountain peak.")
            issue_file_path(media).write_text(
                '{"correct": false, "issues": "Wrong peak.", "suggestions": "Fix it."}',
                encoding="utf-8",
            )

            item = _listing(root)["items"][0]

        self.assertTrue(item["has_issue_file"])
        self.assertEqual(item["issue_fixes"], [])

    def test_response_includes_matching_fingerprint(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")

            self.assertEqual(_listing(root)["fingerprint"], compute_folder_fingerprint(root))

    def test_listing_skips_subfolder_counting_entirely(self) -> None:
        with TempMediaFolder() as root:
            album = root / "Album"
            album.mkdir()
            write_media(album, "one.png")

            clear_folder_summary_cache_for_tests()
            self.addCleanup(clear_folder_summary_cache_for_tests)
            with patch(
                "media_listing._summarize_scan_uncached",
                side_effect=AssertionError("a folder listing must not count subfolder contents"),
            ):
                payload = _listing(root)

        self.assertEqual(payload["subfolders"][0]["name"], "Album")


class FolderReviewCountsEndpointTests(unittest.TestCase):
    def test_counts_caption_issues_and_staged_candidates(self) -> None:
        with TempMediaFolder() as root:
            flagged = write_media(root, "flagged.png")
            issue_file_path(flagged).write_text('{"correct": false}', encoding="utf-8")
            write_media(root, "photo.jpg")
            write_media(root, "plain.png")
            (root / STAGING_DIR_NAME).mkdir()
            # Paired by stem, as the listing pairs it; an unpaired staged file is not counted.
            write_media(root / STAGING_DIR_NAME, "photo.png")
            write_media(root / STAGING_DIR_NAME, "orphan.png")

            response = client.get(f"/api/folders/review-counts?path={quote(str(root))}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["issue_count"], 1)
        self.assertEqual(response.json()["candidate_count"], 1)

    def test_returns_404_for_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = quote(str(root / "does-not-exist"))

            response = client.get(f"/api/folders/review-counts?path={missing}")

        self.assertEqual(response.status_code, 404)


class FolderFingerprintEndpointTests(unittest.TestCase):
    def test_returns_current_signature(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            expected = compute_folder_fingerprint(root)

            response = client.get(f"/api/folders/fingerprint?path={quote(str(root))}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fingerprint"], expected)


if __name__ == "__main__":
    unittest.main()
