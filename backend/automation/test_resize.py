from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from unittest.mock import patch

from PIL import Image

from automation.resize import run_resize_job, validate_resize_folder
from edit_sidecars import backup_path_for, render_slot, write_spec
from ffmpeg_run import FfmpegCancelled
from image_edit import apply_image_edit, read_image_edit_spec, revert_image_edit
from schemas import EditCropRect, ImageEditSpec, SizeFit, VideoEditSpec
from testing_fixtures import TempMediaFolder, write_image, write_mp4_video
from video_edit import SourceProbe, read_edit_spec


class ImageTests(unittest.TestCase):
    def test_renders_the_fit_and_keeps_the_original_for_a_revert(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "wide.png", width=400, height=150)
            original = media.read_bytes()

            result = run_resize_job(root, megapixels=0.02, multiple=32)

            self.assertEqual(result["stats"]["image_success"], 1)
            with Image.open(media) as resized:
                self.assertEqual(resized.size, (224, 96))
            self.assertEqual(backup_path_for(media).read_bytes(), original)

            revert_image_edit(media)
            self.assertEqual(media.read_bytes(), original)

    def test_the_fit_replaces_a_scale_and_keeps_every_other_edit(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "shot.png", width=400, height=300)
            crop = EditCropRect(x=0, y=0, width=0.5, height=1)
            apply_image_edit(media, ImageEditSpec(crop=crop, rotate=90, scale=0.5))

            run_resize_job(root, megapixels=64.0, multiple=8)

            spec = read_image_edit_spec(media)
            assert spec is not None
            self.assertEqual(spec.fit, SizeFit(megapixels=64.0, multiple=8))
            self.assertEqual((spec.crop, spec.rotate, spec.scale), (crop, 90, 1.0))
            with Image.open(media) as resized:
                self.assertEqual(resized.size, (296, 200))

    def test_a_second_run_with_the_same_fit_leaves_the_file_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "wide.png", width=400, height=150)
            run_resize_job(root, megapixels=0.02, multiple=32)
            resized = media.read_bytes()

            result = run_resize_job(root, megapixels=0.02, multiple=32)

            self.assertEqual(result["stats"]["unchanged"], 1)
            self.assertEqual(media.read_bytes(), resized)

    def test_a_file_already_on_the_grid_and_under_budget_is_not_rewritten(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "grid.png", width=64, height=48)
            original = media.read_bytes()

            result = run_resize_job(root, megapixels=2.0, multiple=16)

            self.assertEqual(result["stats"]["unchanged"], 1)
            self.assertEqual(media.read_bytes(), original)
            self.assertFalse(backup_path_for(media).exists())

    def test_a_file_smaller_than_one_cell_is_skipped_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "strip.png", width=400, height=20)

            result = run_resize_job(root, megapixels=1.0, multiple=32)

            self.assertEqual(result["stats"]["skipped"], 1)
            self.assertIsNone(read_image_edit_spec(media))

    def test_a_file_open_in_a_render_is_skipped(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "busy.png", width=400, height=150)

            with render_slot(media):
                result = run_resize_job(root, megapixels=0.02, multiple=32)

            self.assertEqual(result["stats"]["skipped"], 1)

    def test_only_the_selection_is_resized(self) -> None:
        with TempMediaFolder() as root:
            chosen = write_image(root, "chosen.png", width=400, height=150)
            other = write_image(root, "other.png", width=400, height=150)

            run_resize_job(root, megapixels=0.02, multiple=32, selected_paths=[chosen])

            self.assertTrue(backup_path_for(chosen).exists())
            self.assertFalse(backup_path_for(other).exists())


@patch("automation.resize.probe_source", return_value=SourceProbe(size=(3840, 2160)))
class VideoTests(unittest.TestCase):
    def test_stores_the_fit_and_renders_with_the_probe(self, probe) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root)
            write_spec(media, VideoEditSpec(trim_start=1.0, scale=0.5))

            with patch("automation.resize.apply_video_edit") as apply:
                result = run_resize_job(root, megapixels=2.0, multiple=32, ffmpeg="ffmpeg")

            self.assertEqual(result["stats"]["video_success"], 1)
            spec = apply.call_args.args[1]
            self.assertEqual(spec.fit, SizeFit(megapixels=2.0, multiple=32))
            self.assertEqual((spec.trim_start, spec.scale), (1.0, 1.0))
            self.assertIs(apply.call_args.kwargs["probe"], probe.return_value)

    def test_a_failed_render_leaves_the_edit_as_it_was(self, _probe) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root)

            with patch(
                "automation.resize.apply_video_edit", side_effect=RuntimeError("ffmpeg failed")
            ):
                result = run_resize_job(root, megapixels=2.0, multiple=32, ffmpeg="ffmpeg")

            self.assertEqual(result["stats"]["ffmpeg_error"], 1)
            self.assertIsNone(read_edit_spec(media))

    def test_a_cancelled_render_stops_the_run(self, _probe) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "first.mp4")
            write_mp4_video(root, "second.mp4")

            with patch("automation.resize.apply_video_edit", side_effect=FfmpegCancelled):
                result = run_resize_job(root, megapixels=2.0, multiple=32, ffmpeg="ffmpeg")

            self.assertEqual(result["stats"]["cancelled"], 2)


class ValidationTests(unittest.TestCase):
    def test_a_folder_without_editable_media_is_refused(self) -> None:
        with TempMediaFolder() as root:
            (root / "notes.txt").write_text("text", encoding="utf-8")

            with self.assertRaises(ValueError):
                validate_resize_folder(root)

    def test_a_missing_folder_is_refused(self) -> None:
        with TempMediaFolder() as root, self.assertRaises(ValueError):
            validate_resize_folder(root / "missing")


if __name__ == "__main__":
    unittest.main()
