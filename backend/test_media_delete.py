"""Tests for media_delete: Windows Recycle Bin vs permanent unlink."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from captions import issue_file_path
from media_delete import delete_media_with_sidecars, delete_path
from testing_fixtures import TempMediaFolder, write_media, write_mp4_video, write_txt_caption


class DeletePathTests(unittest.TestCase):
    def test_non_windows_unlinks_permanently(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch("media_delete.sys.platform", "linux"):
                delete_path(media)

            self.assertFalse(media.exists())

    @unittest.skipUnless(sys.platform == "win32", "Recycle Bin is a Windows concern")
    def test_windows_routes_through_recycle_bin(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch("media_delete._send_to_recycle_bin") as recycle:
                delete_path(media)

            recycle.assert_called_once_with(media)
            # Helper under test must not also unlink; the recycle call owns removal.
            self.assertTrue(media.exists())

    @unittest.skipUnless(sys.platform == "win32", "Recycle Bin is a Windows concern")
    def test_windows_recycle_bin_removes_file_from_original_path(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            delete_path(media)

            self.assertFalse(media.exists())


class DeleteMediaWithSidecarsTests(unittest.TestCase):
    def test_deletes_media_caption_and_issue_sidecars(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Golden hour.")
            media.with_suffix(".json").write_text('{"description":"JSON"}', encoding="utf-8")
            issue = issue_file_path(media)
            issue.write_text('{"issues":[]}', encoding="utf-8")

            with patch("media_delete.delete_path") as mock_delete:
                result = delete_media_with_sidecars(media)

            deleted_paths = [call.args[0] for call in mock_delete.call_args_list]
            self.assertEqual(deleted_paths[0], media)
            self.assertEqual(
                set(deleted_paths[1:]),
                {
                    media.with_suffix(".json"),
                    media.with_suffix(".txt"),
                    issue,
                },
            )
            self.assertEqual(result["path"], str(media))
            self.assertEqual(
                set(result["deleted"]),
                {"sunset.png", "sunset.txt", "sunset.json", "sunset.png.issue.json"},
            )

    def test_main_file_failure_propagates(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch(
                "media_delete.delete_path",
                side_effect=OSError("access denied"),
            ):
                with self.assertRaises(OSError) as ctx:
                    delete_media_with_sidecars(media)

            self.assertIn("Failed to delete sunset.png", str(ctx.exception))

    def test_sidecar_failure_is_logged_not_raised(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "caption")

            def fail_txt_only(path: Path) -> None:
                if path.suffix == ".txt":
                    raise OSError("locked")
                path.unlink(missing_ok=True)

            with patch("media_delete.delete_path", side_effect=fail_txt_only):
                with self.assertLogs("media_delete", level="WARNING") as logs:
                    result = delete_media_with_sidecars(media)

            self.assertEqual(result["deleted"], ["sunset.png"])
            self.assertTrue(any("Failed to delete sidecar" in line for line in logs.output))


class DeleteVideoEditSidecarTests(unittest.TestCase):
    def test_deleting_a_video_takes_its_original_and_its_edit_spec(self) -> None:
        """A backup left behind is an original nothing in the app can reach again."""
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            backup = root / "clip.mp4.bak"
            backup.write_bytes(b"pristine-original")
            spec = root / "clip.edit.json"
            spec.write_text("{}", encoding="utf-8")

            result = delete_media_with_sidecars(media)

            self.assertEqual(set(result["deleted"]), {"clip.mp4", "clip.mp4.bak", "clip.edit.json"})
            self.assertFalse(backup.exists())
            self.assertFalse(spec.exists())


if __name__ == "__main__":
    unittest.main()
