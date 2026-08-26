"""Tests for /api/folders/contents and /api/folders/fingerprint."""

from __future__ import annotations

import unittest
from unittest.mock import patch
from urllib.parse import quote

from automation.backup_captions import run_backup_captions_job
from captions import issue_file_path
from constants import LAST_FOLDER_KEY, STAGING_DIR_NAME
from db import get_preference, set_preference
from folder_fingerprint import compute_folder_fingerprint
from media_listing import (
    clear_folder_summary_cache_for_tests,
    summarize_folder_contents,
)
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_issue_sidecar,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)


class FolderContentsEndpointTests(unittest.TestCase):
    def test_lists_media_with_caption_metadata(self) -> None:
        with TempMediaFolder() as root:
            captioned = write_media(root, "captioned.png")
            write_txt_caption(captioned, "Has text.")
            write_media(root, "plain.png")

            response = client.get(f"/api/folders/contents?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(root.resolve()))
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

            response = client.get(f"/api/folders/contents?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["parent"], str(root.parent.resolve()))
            self.assertTrue(payload["home"])
            self.assertEqual(payload["breadcrumbs"][-1]["name"], root.name)
            self.assertEqual(payload["subfolder_count"], 1)

            # Counts are deferred to /api/folders/subfolder-stats so the grid can
            # render before every child folder's captions have been read.
            album = payload["subfolders"][0]
            self.assertEqual(album["name"], "album")
            self.assertIsNone(album["file_count"])
            self.assertIsNone(album["captioned_count"])

            stats = client.get(f"/api/folders/subfolder-stats?path={quote(str(root))}")

            self.assertEqual(stats.status_code, 200)
            counted = stats.json()["subfolders"][0]
            self.assertEqual(counted["path"], album["path"])
            self.assertEqual(counted["file_count"], 2)
            self.assertEqual(counted["captioned_count"], 1)

    def test_includes_file_stats_and_dimensions(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, width=128, height=96)

            items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]
            item = next(image for image in items if image["name"] == "photo.png")

            self.assertEqual(item["width"], 128)
            self.assertEqual(item["height"], 96)
            self.assertIn("size", item)
            self.assertIn("modified_at", item)

    def test_includes_the_txt_caption_description(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_txt_caption(media, "A labeled scene.")
            media.with_suffix(".json").write_text(
                '{"description": "Ignored leftover."}\n',
                encoding="utf-8",
            )

            items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]
            item = next(image for image in items if image["media_type"] == "image")

            self.assertEqual(item["description"], "A labeled scene.")
            self.assertNotIn("caption_file_type", item)

    def test_lists_video_without_reading_its_header(self) -> None:
        # The listing reports what the directory scan already knows. Nothing shown
        # for a video needs its container parsed, so nothing parses it.
        with TempMediaFolder() as root:
            write_mp4_video(root, sample_count=120, timescale=30_000, sample_delta=1_000)

            items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]
            item = next(video for video in items if video["media_type"] == "video")

            self.assertEqual(item["media_type"], "video")
            self.assertNotIn("fps", item)

    def test_reports_whether_an_edited_video_can_still_be_reverted(self) -> None:
        """The scan already holds every filename, so this costs no extra file access."""
        with TempMediaFolder() as root:
            write_mp4_video(root, "plain.mp4")
            write_mp4_video(root, "edited.mp4")
            (root / "edited.mp4.bak").write_bytes(b"pristine-original")

            items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]
            by_name = {item["name"]: item for item in items}

            self.assertTrue(by_name["edited.mp4"]["has_backup"])
            self.assertFalse(by_name["plain.mp4"]["has_backup"])

    def test_reports_whether_a_file_has_a_candidate(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "upscaled.png")
            write_media(root, "plain.png")
            staging = root / STAGING_DIR_NAME
            staging.mkdir()
            write_media(staging, "upscaled.png")

            items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]
            by_name = {item["name"]: item for item in items}

            self.assertTrue(by_name["upscaled.png"]["has_candidate"])
            self.assertFalse(by_name["plain.png"]["has_candidate"])

    def test_a_stored_original_is_not_listed_as_media_of_its_own(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4")
            (root / "clip.mp4.bak").write_bytes(b"pristine-original")

            items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]

            self.assertEqual([item["name"] for item in items], ["clip.mp4"])

    def test_lists_gif_as_its_own_media_type(self) -> None:
        with TempMediaFolder() as root:
            write_gif(root, "loop.gif", frames=8)

            items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]
            item = next(entry for entry in items if entry["name"] == "loop.gif")

            # Not "video": the frontend would hand it to a <video> element, which
            # cannot show a GIF at all.
            self.assertEqual(item["media_type"], "gif")

    def test_lists_gif_without_decoding_its_frames(self) -> None:
        # A listing builds every item in a thread pool, so walking each GIF's
        # frames here would turn opening a folder into hundreds of decodes.
        with TempMediaFolder() as root:
            write_gif(root, "loop.gif", frames=8)

            with patch("gif_frames.gif_frame_count") as count:
                items = client.get(f"/api/folders/contents?path={quote(str(root))}").json()["items"]

            count.assert_not_called()
            self.assertTrue(any(entry["name"] == "loop.gif" for entry in items))

    def test_skips_non_media_files(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            (root / "notes.txt").write_text("ignore me", encoding="utf-8")

            names = [
                item["name"]
                for item in client.get(f"/api/folders/contents?path={quote(str(root))}").json()[
                    "items"
                ]
            ]

            self.assertEqual(names, ["alpha.png"])

    def test_reports_caption_backup_presence(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A plain caption.")

            before = client.get(f"/api/folders/contents?path={quote(str(root))}").json()
            self.assertFalse(before["has_caption_backup"])

            run_backup_captions_job(root)

            after = client.get(f"/api/folders/contents?path={quote(str(root))}").json()
            self.assertTrue(after["has_caption_backup"])

    def test_defaults_to_home_without_path_or_saved_folder(self) -> None:
        set_preference(LAST_FOLDER_KEY, "")

        response = client.get("/api/folders/contents")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["path"])

    def test_remembers_last_opened_folder(self) -> None:
        with TempMediaFolder() as root:
            first = client.get(f"/api/folders/contents?path={quote(str(root))}")
            self.assertEqual(first.status_code, 200)

            second = client.get("/api/folders/contents")

            self.assertEqual(second.status_code, 200)
            self.assertEqual(second.json()["path"], str(root.resolve()))
            self.assertEqual(get_preference(LAST_FOLDER_KEY), str(root.resolve()))

    def test_returns_404_for_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            response = client.get(f"/api/folders/contents?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_returns_400_when_path_is_a_file(self) -> None:
        with TempMediaFolder() as root:
            file_path = root / "file.txt"
            file_path.write_text("x", encoding="utf-8")

            response = client.get(f"/api/folders/contents?path={quote(str(file_path))}")

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Path is not a directory")

    def test_includes_sysprompt_in_response(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe scenes in detail.")

            response = client.get(f"/api/folders/contents?path={quote(str(root))}")

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
            write_issue_sidecar(media, 'Replace "red" with "blue".', 'Remove "parked".')

            response = client.get(f"/api/folders/contents?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            item = response.json()["items"][0]
            self.assertTrue(item["has_issue_file"])
            self.assertEqual(
                item["issue_fixes"],
                ['Replace "red" with "blue".', 'Remove "parked".'],
            )

    def test_surfaces_superseded_issue_sidecars_as_broken(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "resolved.png")
            write_txt_caption(media, "A mountain peak.")
            issue_file_path(media).write_text(
                '{"correct": false, "issues": "Wrong peak.", "suggestions": "Fix it."}',
                encoding="utf-8",
            )

            response = client.get(f"/api/folders/contents?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            item = response.json()["items"][0]
            self.assertTrue(item["has_issue_file"])
            self.assertEqual(item["issue_fixes"], [])

    def test_response_includes_matching_fingerprint(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            expected = compute_folder_fingerprint(root)

            response = client.get(f"/api/folders/contents?path={quote(str(root))}")

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

            url = f"/api/folders/subfolder-stats?path={quote(str(root))}"
            clear_folder_summary_cache_for_tests()
            try:
                with patch(
                    "media_listing._summarize_folder_contents_uncached",
                    side_effect=counting_uncached,
                ):
                    first = client.get(url)
                    second = client.get(url)
            finally:
                clear_folder_summary_cache_for_tests()

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(first.json()["subfolders"][0]["file_count"], 1)
            self.assertEqual(uncached_calls["count"], 1)

    def test_listing_skips_subfolder_counting_entirely(self) -> None:
        with TempMediaFolder() as root:
            album = root / "Album"
            album.mkdir()
            write_media(album, "one.png")

            clear_folder_summary_cache_for_tests()
            try:
                with patch(
                    "media_listing._summarize_folder_contents_uncached",
                    side_effect=AssertionError(
                        "a folder listing must not count subfolder contents"
                    ),
                ):
                    response = client.get(f"/api/folders/contents?path={quote(str(root))}")
            finally:
                clear_folder_summary_cache_for_tests()

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["subfolders"][0]["name"], "Album")

    def test_subfolder_stats_rejects_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            response = client.get(f"/api/folders/subfolder-stats?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_remains_available_with_folder_summary_cache(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")

            response = client.get(f"/api/folders/contents?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["item_count"], 1)


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
