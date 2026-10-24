from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import os
import unittest
from pathlib import Path
from unittest.mock import patch

import edit_sidecars
from media_claims import claim
from schemas import AutoAdjust, ColorAdjust, EditCropRect, ImageEditSpec, VideoEditSpec
from testing_fixtures import (
    TempMediaFolder,
    claimed_elsewhere,
    write_edit_backup,
    write_edit_spec,
    write_media,
    write_mp4_video,
)


def _publish(media: Path, data: bytes, spec: ImageEditSpec | VideoEditSpec) -> None:
    """What a render does once it has its output: a temp file published with its spec."""
    temp = edit_sidecars.temp_path_for(media)
    temp.write_bytes(data)
    with claim([media], "render"):
        edit_sidecars.publish_with_spec(temp, media, spec)


def _replace_externally(media: Path, data: bytes) -> None:
    """Another program writing the file: new bytes, and a time the published record never saw."""
    media.write_bytes(data)
    stat = media.stat()
    os.utime(media, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))


class EditRecordTests(unittest.TestCase):
    def test_a_published_spec_reads_back_unchanged(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            spec = VideoEditSpec(
                trim_start=1.0,
                trim_end=5.0,
                speed=2.0,
                scale=0.5,
                crop=EditCropRect(x=0.1, y=0.1, width=0.8, height=0.8),
            )

            _publish(media, b"rendered", spec)

            self.assertEqual(edit_sidecars.read_spec(media, VideoEditSpec), spec)

    def test_auto_keeps_manual_values_for_a_reopened_adjustment_at_its_limit(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            spec = ImageEditSpec(
                adjust=ColorAdjust(exposure=1.0),
                auto_adjust=AutoAdjust(
                    amount=0.5,
                    suggestion=ColorAdjust(exposure=0.2),
                    base=ColorAdjust(exposure=0.95),
                ),
            )
            write_edit_spec(media, spec)
            self.assertEqual(edit_sidecars.read_spec(media, ImageEditSpec), spec)

    def test_an_unedited_file_has_no_spec(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            self.assertIsNone(edit_sidecars.read_spec(media, VideoEditSpec))

    def test_an_unreadable_record_is_ignored_rather_than_raised(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            edit_sidecars.edit_spec_path(media).write_text("{not json", encoding="utf-8")

            with self.assertLogs(edit_sidecars.logger, level="WARNING"):
                self.assertIsNone(edit_sidecars.read_spec(media, VideoEditSpec))

    def test_writing_without_a_claim_is_refused(self) -> None:
        """Every writer claims first; a publish outside one could race a delete."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            temp = edit_sidecars.temp_path_for(media)
            temp.write_bytes(b"rendered")

            with self.assertRaises(RuntimeError):
                edit_sidecars.publish_with_spec(temp, media, ImageEditSpec(rotate=90))


class SidecarPathTests(unittest.TestCase):
    def test_the_backup_and_spec_keep_the_whole_filename(self) -> None:
        """A photo.jpg and a photo.png in one folder must share neither."""
        with TempMediaFolder() as root:
            names = {
                path.name
                for media in (root / "photo.jpg", root / "photo.png")
                for path in (
                    edit_sidecars.backup_path_for(media),
                    edit_sidecars.edit_spec_path(media),
                )
            }
            self.assertEqual(
                names,
                {"photo.jpg.bak", "photo.png.bak", "photo.jpg.edit.json", "photo.png.edit.json"},
            )

    def test_the_temp_and_stale_names_end_on_a_non_media_suffix(self) -> None:
        """folder_scan classifies on the last suffix alone, so neither may look like media."""
        with TempMediaFolder() as root:
            for path in (
                edit_sidecars.temp_path_for(root / "clip.mp4"),
                edit_sidecars.stale_path_for(root / "clip.mp4"),
            ):
                self.assertNotIn(path.suffix.lower(), {".mp4", ".jpg", ".png"})

    def test_edits_render_from_the_backup_once_there_is_one(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.jpg")
            self.assertEqual(edit_sidecars.original_path_for(media), media)

            write_edit_backup(media)
            self.assertEqual(
                edit_sidecars.original_path_for(media), edit_sidecars.backup_path_for(media)
            )


class BeginEditTests(unittest.TestCase):
    def test_the_first_edit_stores_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()

            with claim([media], "render"):
                start = edit_sidecars.begin_edit(media)

            self.assertEqual(start.source.name, "clip.mp4.bak")
            self.assertEqual(start.source.read_bytes(), original)
            self.assertEqual(media.read_bytes(), original)
            self.assertFalse(start.adopted)

    def test_an_existing_backup_is_never_rewritten(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            backup = write_edit_backup(media, b"the-real-original")

            with claim([media], "render"):
                edit_sidecars.begin_edit(media)

            self.assertEqual(backup.read_bytes(), b"the-real-original")

    def test_a_failed_copy_leaves_no_partial_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with (
                claim([media], "render"),
                patch("edit_sidecars.shutil.copy2", side_effect=OSError("disk full")),
                self.assertRaises(OSError),
            ):
                edit_sidecars.begin_edit(media)

            self.assertFalse(edit_sidecars.backup_path_for(media).exists())
            self.assertEqual(list(root.glob("*-tmp")), [])


class ExternalReplacementTests(unittest.TestCase):
    def _edited(self, root: Path) -> Path:
        media = write_media(root, "sunset.png")
        write_edit_backup(media, b"pristine-original")
        _publish(media, b"rendered", ImageEditSpec(rotate=90))
        return media

    def test_a_file_this_app_published_keeps_its_edit_state(self) -> None:
        with TempMediaFolder() as root:
            media = self._edited(root)

            self.assertTrue(edit_sidecars.has_backup(media))
            self.assertEqual(
                edit_sidecars.read_spec(media, ImageEditSpec), ImageEditSpec(rotate=90)
            )

    def test_a_replaced_file_reads_as_unedited_without_anything_changing(self) -> None:
        with TempMediaFolder() as root:
            media = self._edited(root)
            _replace_externally(media, b"replacement")

            self.assertFalse(edit_sidecars.has_backup(media))
            self.assertIsNone(edit_sidecars.read_spec(media, ImageEditSpec))
            self.assertEqual(edit_sidecars.original_path_for(media), media)
            self.assertTrue(edit_sidecars.backup_path_for(media).exists())

    def test_the_next_edit_adopts_the_replacement_as_its_original(self) -> None:
        with TempMediaFolder() as root:
            media = self._edited(root)
            _replace_externally(media, b"replacement")

            with patch("edit_sidecars.delete_path", lambda path: path.unlink()):
                with claim([media], "render"):
                    start = edit_sidecars.begin_edit(media)

            self.assertTrue(start.adopted)
            self.assertEqual(start.source.read_bytes(), b"replacement")
            self.assertFalse(edit_sidecars.edit_spec_path(media).exists())

    def test_a_revert_of_a_replaced_file_keeps_the_replacement(self) -> None:
        with TempMediaFolder() as root:
            media = self._edited(root)
            _replace_externally(media, b"replacement")

            with patch("edit_sidecars.delete_path", lambda path: path.unlink()):
                with claim([media], "render"):
                    reverted = edit_sidecars.restore_backup(media)

            self.assertFalse(reverted)
            self.assertEqual(media.read_bytes(), b"replacement")
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())

    def test_an_in_app_rewrite_keeps_the_lineage(self) -> None:
        with TempMediaFolder() as root:
            media = self._edited(root)
            _replace_externally(media, b"metadata stripped")

            with claim([media], "render"):
                edit_sidecars.refresh_published(media)

            self.assertTrue(edit_sidecars.has_backup(media))

    def test_a_backup_without_a_record_is_trusted(self) -> None:
        """Nothing says the file changed, so the original stays the one to render from."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            backup = write_edit_backup(media, b"pristine-original")

            with claim([media], "render"):
                start = edit_sidecars.begin_edit(media)

            self.assertFalse(start.adopted)
            self.assertEqual(start.source, backup)


class RestoreBackupTests(unittest.TestCase):
    def test_the_original_comes_back_and_both_sidecars_go(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_edit_backup(media, b"pristine-original")
            write_edit_spec(media, ImageEditSpec(rotate=180))

            with claim([media], "render"):
                self.assertTrue(edit_sidecars.restore_backup(media))

            self.assertEqual(media.read_bytes(), b"pristine-original")
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())
            self.assertFalse(edit_sidecars.edit_spec_path(media).exists())

    def test_restoring_without_a_backup_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with claim([media], "render"), self.assertRaises(ValueError):
                edit_sidecars.restore_backup(media)

    def test_a_failed_install_keeps_the_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            backup = write_edit_backup(media, b"pristine-original")

            with (
                claim([media], "render"),
                patch("edit_sidecars.publish_replacing", side_effect=OSError("denied")),
                self.assertRaises(OSError),
            ):
                edit_sidecars.restore_backup(media)

            self.assertEqual(backup.read_bytes(), b"pristine-original")


class SweepTests(unittest.TestCase):
    def test_leftovers_from_a_hard_kill_are_dropped(self) -> None:
        with TempMediaFolder() as root:
            keeper = write_media(root, "sunset.png")
            (root / "sunset.png.edit-tmp").write_bytes(b"junk")
            (root / "sunset.png.edit-stale").write_bytes(b"junk")

            edit_sidecars.sweep_edit_temp_files(root)

            self.assertEqual(list(root.glob("*.edit-tmp")), [])
            self.assertEqual(list(root.glob("*.edit-stale")), [])
            self.assertTrue(keeper.is_file())

    def test_another_files_render_in_progress_is_left_alone(self) -> None:
        with TempMediaFolder() as root:
            rendering = write_media(root, "busy.png")
            temp = edit_sidecars.temp_path_for(rendering)
            temp.write_bytes(b"half-written")

            with claimed_elsewhere(rendering):
                edit_sidecars.sweep_edit_temp_files(root)

            self.assertEqual(temp.read_bytes(), b"half-written")

    def test_a_parked_original_with_no_live_file_is_moved_back(self) -> None:
        with TempMediaFolder() as root:
            stale = edit_sidecars.stale_path_for(root / "clip.mp4")
            stale.write_bytes(b"only-copy")

            edit_sidecars.sweep_edit_temp_files(root)

            self.assertEqual((root / "clip.mp4").read_bytes(), b"only-copy")
            self.assertFalse(stale.exists())


if __name__ == "__main__":
    unittest.main()
