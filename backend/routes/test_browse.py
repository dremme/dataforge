"""Tests for /api/browse and /api/browse/fingerprint."""

from __future__ import annotations

import unittest
from unittest.mock import patch
from urllib.parse import quote

from automation.backup_captions import run_backup_captions_job
from constants import LAST_FOLDER_KEY
from db import get_preference, set_preference
from folder_fingerprint import folder_browse_fingerprint
from media_listing import (
    clear_folder_summary_cache_for_tests,
    summarize_folder_contents,
)
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    write_json_caption,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)


class BrowseEndpointTests(unittest.TestCase):
    def test_lists_media_with_caption_metadata(self) -> None:
        with TempMediaFolder() as root:
            captioned = write_media(root, "captioned.png")
            write_txt_caption(captioned, "Has text.")
            write_media(root, "plain.png")

            response = client.get(f"/api/browse?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["folder"], str(root.resolve()))
            self.assertEqual(payload["item_count"], 2)

            by_name = {item["name"]: item for item in payload["items"]}
            self.assertIsNone(payload["sysprompt"])
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

            response = client.get(f"/api/browse?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["parent"], str(root.parent.resolve()))
            self.assertTrue(payload["home"])
            self.assertEqual(payload["breadcrumbs"][-1]["name"], root.name)
            self.assertEqual(payload["subfolder_count"], 1)

            album = payload["subfolders"][0]
            self.assertEqual(album["name"], "album")
            self.assertEqual(album["file_count"], 2)
            self.assertEqual(album["captioned_count"], 1)

    def test_includes_file_stats_without_dimensions(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, width=128, height=96)

            items = client.get(f"/api/browse?path={quote(str(root))}").json()["items"]
            item = next(image for image in items if image["name"] == "photo.png")

            self.assertIsNone(item.get("width"))
            self.assertIsNone(item.get("height"))
            self.assertIn("size", item)
            self.assertIn("modified_at", item)

    def test_includes_json_caption_bboxes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_json_caption(
                media,
                {
                    "description": "A labeled scene.",
                    "elements": [{"desc": "Sign", "bbox": [1500, 1600, 1700, 1800]}],
                },
            )

            items = client.get(f"/api/browse?path={quote(str(root))}").json()["items"]
            item = next(image for image in items if image["media_type"] == "image")

            self.assertEqual(item["description"], "A labeled scene.")
            self.assertTrue(item["has_bboxes"])
            self.assertIsNone(item.get("bboxes"))

    def test_lists_video_without_parsing_frame_stats(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, sample_count=120, timescale=30_000, sample_delta=1_000)

            items = client.get(f"/api/browse?path={quote(str(root))}").json()["items"]
            item = next(video for video in items if video["media_type"] == "video")

            self.assertEqual(item["media_type"], "video")
            self.assertIsNone(item.get("frame_count"))
            self.assertIsNone(item.get("fps"))

    def test_skips_non_media_files(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            (root / "notes.txt").write_text("ignore me", encoding="utf-8")

            names = [
                item["name"]
                for item in client.get(f"/api/browse?path={quote(str(root))}").json()["items"]
            ]

            self.assertEqual(names, ["alpha.png"])

    def test_reports_caption_backup_presence(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A plain caption.")

            before = client.get(f"/api/browse?path={quote(str(root))}").json()
            self.assertFalse(before["has_caption_backup"])

            run_backup_captions_job(root)

            after = client.get(f"/api/browse?path={quote(str(root))}").json()
            self.assertTrue(after["has_caption_backup"])

    def test_defaults_to_home_without_path_or_saved_folder(self) -> None:
        set_preference(LAST_FOLDER_KEY, "")

        response = client.get("/api/browse")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["folder"])

    def test_remembers_last_browsed_folder(self) -> None:
        with TempMediaFolder() as root:
            first = client.get(f"/api/browse?path={quote(str(root))}")
            self.assertEqual(first.status_code, 200)

            second = client.get("/api/browse")

            self.assertEqual(second.status_code, 200)
            self.assertEqual(second.json()["folder"], str(root.resolve()))
            self.assertEqual(get_preference(LAST_FOLDER_KEY), str(root.resolve()))

    def test_returns_404_for_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            response = client.get(f"/api/browse?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_returns_400_when_path_is_a_file(self) -> None:
        with TempMediaFolder() as root:
            file_path = root / "file.txt"
            file_path.write_text("x", encoding="utf-8")

            response = client.get(f"/api/browse?path={quote(str(file_path))}")

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Path is not a directory")

    def test_includes_sysprompt_in_response(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe scenes in detail.")

            response = client.get(f"/api/browse?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            sysprompt = payload["sysprompt"]
            self.assertEqual(len(payload["items"]), 0)
            self.assertEqual(sysprompt["name"], ".sysprompt")
            self.assertEqual(sysprompt["media_type"], "sysprompt")
            self.assertEqual(sysprompt["description"], "Describe scenes in detail.")
            self.assertEqual(sysprompt["caption_status"], "text")

    def test_includes_caption_issue_metadata(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "flagged.png")
            write_txt_caption(media, "A red car.")
            media.with_suffix(".issue.json").write_text(
                '{"correct": false, "issues": "Car is blue.", "suggestions": "Fix color."}',
                encoding="utf-8",
            )

            response = client.get(f"/api/browse?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            item = response.json()["items"][0]
            self.assertTrue(item["has_issue_file"])
            self.assertEqual(item["issue"], "Car is blue.")
            self.assertEqual(item["issue_suggestions"], "Fix color.")

    def test_ignores_stale_issue_sidecars_marked_correct(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "resolved.png")
            write_txt_caption(media, "A mountain peak.")
            media.with_suffix(".issue.json").write_text(
                '{"correct": true, "issues": "None", "suggestions": "None"}',
                encoding="utf-8",
            )

            response = client.get(f"/api/browse?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            item = response.json()["items"][0]
            self.assertFalse(item["has_issue_file"])
            self.assertIsNone(item["issue"])
            self.assertIsNone(item["issue_suggestions"])

    def test_response_includes_matching_fingerprint(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            expected = folder_browse_fingerprint(root)

            response = client.get(f"/api/browse?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["fingerprint"], expected)

    def test_subfolder_stats_use_cached_summaries(self) -> None:
        with TempMediaFolder() as root:
            album = root / "Album"
            album.mkdir()
            write_media(album, "one.png")
            uncached_calls = {"count": 0}
            original = summarize_folder_contents.__globals__["_summarize_folder_contents_uncached"]

            def counting_uncached(folder):
                uncached_calls["count"] += 1
                return original(folder)

            clear_folder_summary_cache_for_tests()
            try:
                with patch(
                    "media_listing._summarize_folder_contents_uncached",
                    side_effect=counting_uncached,
                ):
                    first = client.get(f"/api/browse?path={quote(str(root))}")
                    second = client.get(f"/api/browse?path={quote(str(root))}")
            finally:
                clear_folder_summary_cache_for_tests()

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(first.json()["subfolders"][0]["file_count"], 1)
            self.assertEqual(uncached_calls["count"], 1)

    def test_remains_available_with_folder_summary_cache(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")

            response = client.get(f"/api/browse?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["item_count"], 1)


class BrowseFingerprintEndpointTests(unittest.TestCase):
    def test_returns_current_signature(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            expected = folder_browse_fingerprint(root)

            response = client.get(f"/api/browse/fingerprint?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["fingerprint"], expected)


if __name__ == "__main__":
    unittest.main()
