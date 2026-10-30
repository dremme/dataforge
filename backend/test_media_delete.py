from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from candidate_pairing import candidate_sidecar_path
from captions import issue_file_path
from constants import CAPTION_BACKUP_DIR_NAME, STAGING_DIR_NAME
from file_trash import delete_path
from media_delete import (
    MediaReappearedError,
    delete_leftovers,
    delete_media_with_sidecars,
    restore_media_with_sidecars,
)
from testing_fixtures import (
    TempMediaFolder,
    write_media,
    write_mp4_video,
    write_txt_caption,
    write_wav,
)


def _fail_txt_only(path: Path) -> None:
    if path.suffix == ".txt":
        raise OSError("locked")
    path.unlink(missing_ok=True)


class DeletePathTests(unittest.TestCase):
    def test_non_windows_unlinks_permanently(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch("file_trash.sys.platform", "linux"):
                delete_path(media)

            self.assertFalse(media.exists())

    @unittest.skipUnless(sys.platform == "win32", "Recycle Bin is a Windows concern")
    def test_windows_routes_through_recycle_bin(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch("file_trash._send_to_recycle_bin") as recycle:
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
            leftover = media.with_suffix(".json")
            leftover.write_text('{"description":"JSON"}', encoding="utf-8")
            issue = issue_file_path(media)
            issue.write_text('{"issues":[]}', encoding="utf-8")

            with patch("media_delete.delete_path") as mock_delete:
                result = delete_media_with_sidecars(media)

            deleted_paths = [call.args[0] for call in mock_delete.call_args_list]
            self.assertEqual(deleted_paths[0], media)
            self.assertEqual(
                set(deleted_paths[1:]),
                {
                    media.with_suffix(".txt"),
                    issue,
                },
            )
            self.assertEqual(result["path"], str(media))
            self.assertEqual(
                set(result["deleted"]),
                {"sunset.png", "sunset.txt", "sunset.png.issue.json"},
            )
            self.assertTrue(leftover.is_file())

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

    def test_a_sidecar_that_cannot_be_deleted_is_reported_as_retained(self) -> None:
        """The audit's F14: the response used to say nothing while the caption stayed."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = write_txt_caption(media, "caption")

            with patch("media_delete.delete_path", side_effect=_fail_txt_only):
                result = delete_media_with_sidecars(media)

            self.assertEqual(result["deleted"], ["sunset.png"])
            self.assertEqual(result["retained"], [{"path": str(caption), "message": "locked"}])

    def test_a_retained_sidecar_can_be_cleaned_up_once_it_is_free(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = write_txt_caption(media, "caption")
            with patch("media_delete.delete_path", side_effect=_fail_txt_only):
                delete_media_with_sidecars(media)

            with patch("media_delete.delete_path", lambda path: path.unlink()):
                result = delete_leftovers(media, [caption])

            self.assertEqual(result["deleted"], ["sunset.txt"])
            self.assertEqual(result["retained"], [])
            self.assertFalse(caption.exists())

    def test_cleanup_refuses_a_caption_a_sibling_still_shares(self) -> None:
        with TempMediaFolder() as root:
            caption = write_txt_caption(write_media(root, "scene.png"), "caption")

            with self.assertRaises(ValueError):
                delete_leftovers(root / "scene.jpg", [caption])

            self.assertTrue(caption.exists())

    def test_cleanup_refuses_once_the_media_is_back(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = write_txt_caption(media, "caption")

            with self.assertRaises(MediaReappearedError):
                delete_leftovers(media, [caption])

    def test_a_stale_copy_from_a_failed_publish_goes_too(self) -> None:
        """A folder sweep would move it back onto the deleted name."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            stale = root / "sunset.png.edit-stale"
            stale.write_bytes(b"previous")

            with patch("media_delete.delete_path", lambda path: path.unlink()):
                delete_media_with_sidecars(media)

            self.assertFalse(stale.exists())


class DeleteVideoEditSidecarTests(unittest.TestCase):
    def test_deleting_a_video_takes_its_original_and_its_edit_spec(self) -> None:
        """A backup left behind is an original nothing in the app can reach again."""
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            backup = root / "clip.mp4.bak"
            backup.write_bytes(b"pristine-original")
            spec = root / "clip.mp4.edit.json"
            spec.write_text("{}", encoding="utf-8")

            result = delete_media_with_sidecars(media)

            self.assertEqual(
                set(result["deleted"]), {"clip.mp4", "clip.mp4.bak", "clip.mp4.edit.json"}
            )
            self.assertFalse(backup.exists())
            self.assertFalse(spec.exists())


class DeleteNameLinkedFilesTests(unittest.TestCase):
    def test_deletes_the_backup_caption_and_staged_candidate(self) -> None:
        # Left behind, a later file of the same name would inherit both.
        with TempMediaFolder() as root:
            media = write_media(root, "photo.jpg")
            backup = root / CAPTION_BACKUP_DIR_NAME / "photo.txt"
            backup.parent.mkdir()
            backup.write_text("Original.", encoding="utf-8")
            (root / STAGING_DIR_NAME).mkdir()
            candidate = write_media(root / STAGING_DIR_NAME, "photo.png")
            record = candidate_sidecar_path(candidate)
            record.write_text("{}", encoding="utf-8")
            unrelated = write_media(root / STAGING_DIR_NAME, "other.png")

            with patch("file_trash.sys.platform", "linux"):
                delete_media_with_sidecars(media)

            self.assertFalse(backup.exists())
            self.assertFalse(candidate.exists())
            self.assertFalse(record.exists())
            self.assertTrue(unrelated.is_file())


class SharedStemDeleteTests(unittest.TestCase):
    def test_a_sibling_keeps_the_caption_they_share(self) -> None:
        with TempMediaFolder() as root:
            jpg = write_media(root, "item.jpg")
            png = write_media(root, "item.png")
            caption = write_txt_caption(png, "Shared.")

            with patch("file_trash.sys.platform", "linux"):
                delete_media_with_sidecars(jpg)

            self.assertFalse(jpg.exists())
            self.assertEqual(caption.read_text(encoding="utf-8"), "Shared.")

    def test_an_audio_sibling_keeps_the_caption_they_share(self) -> None:
        with TempMediaFolder() as root:
            cover = write_media(root, "song.png")
            write_wav(root, "song.wav")
            caption = write_txt_caption(cover, "Shared.")

            with patch("file_trash.sys.platform", "linux"):
                delete_media_with_sidecars(cover)

            self.assertEqual(caption.read_text(encoding="utf-8"), "Shared.")

    def test_the_last_owner_takes_the_caption_with_it(self) -> None:
        with TempMediaFolder() as root:
            png = write_media(root, "item.png")
            caption = write_txt_caption(png, "Mine.")

            with patch("file_trash.sys.platform", "linux"):
                delete_media_with_sidecars(png)

            self.assertFalse(caption.exists())


@unittest.skipUnless(sys.platform == "win32", "Recycle Bin is a Windows concern")
class RestoreMediaWithSidecarsTests(unittest.TestCase):
    def test_a_delete_reports_what_it_recycled_and_undoes_it(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            caption = write_txt_caption(media, "Golden hour.")

            deleted = delete_media_with_sidecars(media)
            self.assertEqual(deleted["recycled"], [str(media), str(caption)])

            media_path, *files = deleted["recycled"]
            result = restore_media_with_sidecars(Path(media_path), [Path(raw) for raw in files])

            self.assertEqual(
                result, {"restored": [str(media), str(caption)], "missing": [], "failed": []}
            )
            self.assertEqual(caption.read_text(encoding="utf-8"), "Golden hour.")

    def test_restores_only_files_of_the_restored_media(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            other = write_media(root, "beach.png")
            delete_media_with_sidecars(media)
            delete_path(other)

            result = restore_media_with_sidecars(media, [other])

            self.assertEqual(result["restored"], [str(media)])
            self.assertEqual([entry["path"] for entry in result["failed"]], [str(other)])
            self.assertFalse(other.exists())

    def test_reports_media_the_bin_no_longer_holds(self) -> None:
        with TempMediaFolder() as root:
            media = root / "gone.png"

            result = restore_media_with_sidecars(media, [])

            self.assertEqual(result, {"restored": [], "missing": [str(media)], "failed": []})


class RecycledListTests(unittest.TestCase):
    def test_permanent_deletes_report_nothing_recyclable(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch("file_trash.sys.platform", "linux"):
                result = delete_media_with_sidecars(media)

            self.assertEqual(result["recycled"], [])


if __name__ == "__main__":
    unittest.main()
