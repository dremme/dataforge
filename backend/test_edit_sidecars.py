from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import threading
import unittest
from unittest.mock import patch

import edit_sidecars
from schemas import AutoAdjust, ColorAdjust, EditCropRect, ImageEditSpec, VideoEditSpec
from testing_fixtures import TempMediaFolder, write_media, write_mp4_video


class EditSpecSidecarTests(unittest.TestCase):
    def test_a_written_spec_reads_back_unchanged(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            spec = VideoEditSpec(
                trim_start=1.0,
                trim_end=5.0,
                speed=2.0,
                scale=0.5,
                crop=EditCropRect(x=0.1, y=0.1, width=0.8, height=0.8),
            )

            edit_sidecars.write_spec(media, spec)

            self.assertEqual(edit_sidecars.read_spec(media, VideoEditSpec), spec)

    def test_the_model_asked_for_is_the_model_returned(self) -> None:
        """The sidecar name is shared, so the reader - not the file - picks the shape."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            spec = ImageEditSpec(rotate=90, mirror_h=True, scale=0.5)

            edit_sidecars.write_spec(media, spec)

            self.assertEqual(edit_sidecars.read_spec(media, ImageEditSpec), spec)

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
            edit_sidecars.write_spec(media, spec)
            self.assertEqual(edit_sidecars.read_spec(media, ImageEditSpec), spec)

    def test_an_unedited_file_has_no_spec(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            self.assertIsNone(edit_sidecars.read_spec(media, VideoEditSpec))

    def test_an_unreadable_spec_is_ignored_rather_than_raised(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            edit_sidecars.edit_spec_path(media).write_text("{not json", encoding="utf-8")

            with self.assertLogs(edit_sidecars.logger, level="WARNING"):
                self.assertIsNone(edit_sidecars.read_spec(media, VideoEditSpec))

    def test_clearing_a_spec_that_is_not_there_is_not_an_error(self) -> None:
        with TempMediaFolder() as root:
            edit_sidecars.clear_spec(write_mp4_video(root, "clip.mp4"))


class SidecarPathTests(unittest.TestCase):
    def test_the_backup_keeps_the_whole_filename(self) -> None:
        """A photo.jpg and a photo.png in one folder must not share a backup."""
        with TempMediaFolder() as root:
            self.assertEqual(
                edit_sidecars.backup_path_for(root / "photo.jpg").name, "photo.jpg.bak"
            )
            self.assertEqual(
                edit_sidecars.backup_path_for(root / "photo.png").name, "photo.png.bak"
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

            edit_sidecars.ensure_backup(media)
            self.assertEqual(
                edit_sidecars.original_path_for(media), edit_sidecars.backup_path_for(media)
            )


class LegacyColorSidecarTests(unittest.TestCase):
    """Sidecars written before the Adjust tool carried five flat color fields."""

    def test_old_color_fields_reopen_as_the_nearest_tools(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.jpg")
            edit_sidecars.edit_spec_path(media).write_text(
                '{"rotate": 90, "brightness": 1.2, "contrast": 0.9, "saturation": 1.3,'
                ' "warmth": 0.5, "hue": 300.0}',
                encoding="utf-8",
            )

            spec = edit_sidecars.read_spec(media, ImageEditSpec)

        assert spec is not None
        self.assertEqual(spec.rotate, 90)
        self.assertGreater(spec.adjust.exposure, 0.2)
        self.assertAlmostEqual(spec.adjust.contrast, -0.1)
        self.assertAlmostEqual(spec.adjust.saturation, 0.3)
        self.assertGreater(spec.adjust.warmth, 0.5)
        self.assertAlmostEqual(spec.adjust.hue, -60.0)

    def test_untouched_old_color_fields_migrate_to_resting_tools(self) -> None:
        spec = VideoEditSpec.model_validate(
            {
                "speed": 2.0,
                "brightness": 1.0,
                "contrast": 1.0,
                "saturation": 1.0,
                "warmth": 0.0,
                "hue": 0.0,
            }
        )

        self.assertEqual(spec.speed, 2.0)
        self.assertEqual(spec.adjust, ColorAdjust())

    def test_blacking_out_a_file_migrates_to_the_darkest_exposure(self) -> None:
        spec = ImageEditSpec.model_validate({"brightness": 0.0})

        self.assertEqual(spec.adjust.exposure, -1.0)

    def test_a_current_sidecar_is_read_as_written(self) -> None:
        spec = ImageEditSpec(adjust=ColorAdjust(contrast=0.4))

        self.assertEqual(ImageEditSpec.model_validate(spec.model_dump()), spec)


class EnsureBackupTests(unittest.TestCase):
    def test_the_first_edit_stores_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()

            backup = edit_sidecars.ensure_backup(media)

            self.assertEqual(backup.name, "clip.mp4.bak")
            self.assertEqual(backup.read_bytes(), original)
            self.assertEqual(media.read_bytes(), original)

    def test_an_existing_backup_is_never_rewritten(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            backup = edit_sidecars.backup_path_for(media)
            backup.write_bytes(b"the-real-original")

            edit_sidecars.ensure_backup(media)

            self.assertEqual(backup.read_bytes(), b"the-real-original")

    def test_a_failed_copy_leaves_no_partial_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("edit_sidecars.shutil.copy2", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    edit_sidecars.ensure_backup(media)

            self.assertFalse(edit_sidecars.backup_path_for(media).exists())
            self.assertEqual(list(root.glob("*-tmp")), [])


class RestoreBackupTests(unittest.TestCase):
    def test_the_original_comes_back_and_both_sidecars_go(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            edit_sidecars.backup_path_for(media).write_bytes(b"pristine-original")
            edit_sidecars.write_spec(media, ImageEditSpec(rotate=180))

            edit_sidecars.restore_backup(media)

            self.assertEqual(media.read_bytes(), b"pristine-original")
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())
            self.assertFalse(edit_sidecars.edit_spec_path(media).exists())

    def test_restoring_without_a_backup_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with self.assertRaises(ValueError):
                edit_sidecars.restore_backup(media)

    def test_a_failed_install_keeps_the_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            backup = edit_sidecars.backup_path_for(media)
            backup.write_bytes(b"pristine-original")

            with patch("edit_sidecars.publish_replacing", side_effect=OSError("denied")):
                with self.assertRaises(OSError):
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

            with edit_sidecars.render_slot(rendering):
                edit_sidecars.sweep_edit_temp_files(root)

            self.assertEqual(temp.read_bytes(), b"half-written")

    def test_a_parked_original_with_no_live_file_is_moved_back(self) -> None:
        with TempMediaFolder() as root:
            stale = edit_sidecars.stale_path_for(root / "clip.mp4")
            stale.write_bytes(b"only-copy")

            edit_sidecars.sweep_edit_temp_files(root)

            self.assertEqual((root / "clip.mp4").read_bytes(), b"only-copy")
            self.assertFalse(stale.exists())


class RenderSlotTests(unittest.TestCase):
    def test_a_second_render_of_the_same_file_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with edit_sidecars.render_slot(media):
                with self.assertRaises(edit_sidecars.EditBusyError):
                    with edit_sidecars.render_slot(media):
                        pass

    def test_the_slot_is_released_even_when_the_render_raises(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with self.assertRaises(RuntimeError):
                with edit_sidecars.render_slot(media):
                    raise RuntimeError("bad filter")

            with edit_sidecars.render_slot(media):
                pass

    def test_another_file_gets_its_own_slot(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")

            with edit_sidecars.render_slot(first):
                with edit_sidecars.render_slot(second):
                    pass

    def test_cancelling_sets_the_flag_the_render_polls(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            entered = threading.Event()
            seen: list[bool] = []

            def render() -> None:
                with edit_sidecars.render_slot(media) as should_cancel:
                    entered.set()
                    while not should_cancel():
                        pass
                    seen.append(True)

            worker = threading.Thread(target=render)
            worker.start()
            entered.wait(timeout=5)

            self.assertTrue(edit_sidecars.cancel_render(media))
            worker.join(timeout=5)

            self.assertEqual(seen, [True])

    def test_cancelling_an_idle_file_reports_that_there_was_nothing_to_stop(self) -> None:
        with TempMediaFolder() as root:
            self.assertFalse(edit_sidecars.cancel_render(write_media(root, "sunset.png")))


if __name__ == "__main__":
    unittest.main()
