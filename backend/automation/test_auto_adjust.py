from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from automation.auto_adjust import run_auto_adjust_job, validate_auto_adjust_folder
from color_auto import suggest_adjust
from edit_sidecars import backup_path_for, edit_spec_path, render_slot, write_spec
from ffmpeg_run import FfmpegCancelled
from image_edit import apply_image_edit, read_image_edit_spec
from schemas import AutoAdjust, ColorAdjust, EditCropRect, ImageEditSpec, MaskRegion, VideoEditSpec
from testing_fixtures import TempMediaFolder, write_image, write_mp4_video
from video_edit import SourceProbe, read_edit_spec

DARK = (40, 32, 28)
DARK_PIXELS = np.full((64, 3), 0.15)


def results_by_name(result: dict[str, object]) -> dict[str, dict[str, object]]:
    results = result["results"]
    assert isinstance(results, list)
    return {str(entry["name"]): entry for entry in results}


class ImageTests(unittest.TestCase):
    def test_reset_clears_manual_and_auto_color_but_keeps_other_edits(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=80, height=40, color=DARK)
            original = media.read_bytes()
            earlier = ImageEditSpec(
                crop=EditCropRect(x=0, y=0, width=0.5, height=1),
                masks=[MaskRegion(x=0, y=0, width=1, height=1)],
                mirror_h=True,
                mirror_v=True,
                rotate=90,
                scale=0.5,
                adjust=ColorAdjust(tint=0.2, hue=30, definition=0.4),
                auto_adjust=AutoAdjust(suggestion=ColorAdjust(exposure=0.3)),
            )
            apply_image_edit(media, earlier)

            with patch("automation.auto_adjust.image_analysis_pixels") as analyse:
                result = run_auto_adjust_job(root, reset_adjustments=True, replace_adjustments=True)

            self.assertEqual(result["stats"]["image_success"], 1)
            self.assertEqual(
                read_image_edit_spec(media),
                earlier.model_copy(update={"adjust": ColorAdjust(), "auto_adjust": None}),
            )
            self.assertEqual(backup_path_for(media).read_bytes(), original)
            analyse.assert_not_called()
            with Image.open(media) as edited:
                self.assertEqual(edited.size, (20, 20))
                self.assertEqual(edited.getpixel((0, 0)), DARK)

    def test_reset_leaves_unadjusted_files_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", color=DARK)
            original = media.read_bytes()

            result = run_auto_adjust_job(root, reset_adjustments=True)

            self.assertEqual(result["stats"]["unchanged"], 1)
            self.assertEqual(media.read_bytes(), original)
            self.assertFalse(backup_path_for(media).exists())
            self.assertFalse(edit_spec_path(media).exists())

    def test_reset_clears_auto_state_even_if_color_values_are_already_zero(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", color=DARK)
            apply_image_edit(
                media, ImageEditSpec(auto_adjust=AutoAdjust(amount=0, suggestion=ColorAdjust()))
            )

            result = run_auto_adjust_job(root, reset_adjustments=True)

            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(read_image_edit_spec(media), ImageEditSpec())

    def test_renders_the_suggestion_and_keeps_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dusk.png", color=DARK)
            original = media.read_bytes()

            result = run_auto_adjust_job(root)

            self.assertEqual(result["stats"]["image_success"], 1)
            self.assertEqual(backup_path_for(media).read_bytes(), original)
            spec = read_image_edit_spec(media)
            assert spec is not None and spec.auto_adjust is not None
            self.assertGreater(spec.adjust.exposure, 0)
            self.assertEqual(spec.adjust, spec.auto_adjust.suggestion)
            with Image.open(media) as edited:
                self.assertGreater(edited.getpixel((0, 0))[0], DARK[0])

    def test_a_second_run_leaves_an_adjusted_file_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dusk.png", color=DARK)
            run_auto_adjust_job(root)
            adjusted = media.read_bytes()

            result = run_auto_adjust_job(root)

            self.assertEqual(result["stats"]["unchanged"], 1)
            self.assertEqual(media.read_bytes(), adjusted)

    def test_an_earlier_edit_is_kept_and_analysed_through_its_crop(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dusk.png", width=80, height=40, color=DARK)
            crop = EditCropRect(x=0.0, y=0.0, width=0.5, height=1.0)
            apply_image_edit(media, ImageEditSpec(crop=crop, adjust=ColorAdjust(tint=0.2)))

            run_auto_adjust_job(root)

            spec = read_image_edit_spec(media)
            assert spec is not None and spec.auto_adjust is not None
            self.assertEqual(spec.crop, crop)
            self.assertAlmostEqual(spec.adjust.tint, 0.2 + spec.auto_adjust.suggestion.tint)
            with Image.open(media) as edited:
                self.assertEqual(edited.size, (40, 40))

    def test_replacing_starts_the_color_over_but_keeps_the_rest_of_the_edit(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dusk.png", width=80, height=40, color=DARK)
            crop = EditCropRect(x=0.0, y=0.0, width=0.5, height=1.0)
            manual = ColorAdjust(tint=0.2, hue=30.0, definition=0.4)
            apply_image_edit(media, ImageEditSpec(crop=crop, adjust=manual))

            run_auto_adjust_job(root, replace_adjustments=True)

            spec = read_image_edit_spec(media)
            assert spec is not None and spec.auto_adjust is not None
            self.assertEqual(spec.crop, crop)
            self.assertEqual(spec.adjust, spec.auto_adjust.suggestion)
            self.assertEqual(spec.auto_adjust.base, ColorAdjust())

    def test_replacing_a_clean_auto_adjust_leaves_it_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dusk.png", color=DARK)
            run_auto_adjust_job(root)
            adjusted = media.read_bytes()

            result = run_auto_adjust_job(root, replace_adjustments=True)

            self.assertEqual(result["stats"]["unchanged"], 1)
            self.assertEqual(media.read_bytes(), adjusted)

    def test_a_file_open_in_a_render_is_skipped_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dusk.png", color=DARK)
            original = media.read_bytes()

            with render_slot(media):
                result = run_auto_adjust_job(root)

            self.assertEqual(results_by_name(result)["dusk.png"]["status"], "skipped")
            self.assertEqual(media.read_bytes(), original)
            self.assertFalse(edit_spec_path(media).exists())

    def test_a_fully_masked_file_is_skipped(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dusk.png", color=DARK)
            write_spec(media, ImageEditSpec(masks=[MaskRegion(x=0, y=0, width=1, height=1)]))

            result = run_auto_adjust_job(root)

            self.assertEqual(result["stats"]["skipped"], 1)
            self.assertFalse(backup_path_for(media).exists())

    def test_an_unreadable_file_fails_without_stopping_the_rest(self) -> None:
        with TempMediaFolder() as root:
            (root / "broken.png").write_bytes(b"not an image")
            write_image(root, "dusk.png", color=DARK)

            result = run_auto_adjust_job(root)

            self.assertEqual(results_by_name(result)["broken.png"]["status"], "read_error")
            self.assertEqual(result["stats"]["success"], 1)

    def test_only_the_selection_is_adjusted(self) -> None:
        with TempMediaFolder() as root:
            chosen = write_image(root, "chosen.png", color=DARK)
            other = write_image(root, "other.png", color=DARK)

            run_auto_adjust_job(root, selected_paths=[chosen])

            self.assertTrue(backup_path_for(chosen).exists())
            self.assertFalse(backup_path_for(other).exists())


@patch("automation.auto_adjust.probe_source", return_value=SourceProbe(seconds=10.0))
@patch("automation.auto_adjust.video_analysis_pixels", return_value=(DARK_PIXELS, np.ones(64)))
class VideoTests(unittest.TestCase):
    def test_reset_keeps_all_other_video_edits_and_skips_analysis(self, analyse, probe) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root)
            earlier = VideoEditSpec(
                trim_start=2,
                trim_end=6,
                crop=EditCropRect(x=0, y=0, width=0.5, height=1),
                masks=[MaskRegion(x=0, y=0, width=1, height=1)],
                speed=1.5,
                scale=0.5,
                volume=0,
                adjust=ColorAdjust(exposure=0.3, noise_reduction=0.5),
                auto_adjust=AutoAdjust(suggestion=ColorAdjust(exposure=0.3)),
            )
            write_spec(media, earlier)

            with patch("automation.auto_adjust.apply_video_edit") as apply:
                result = run_auto_adjust_job(root, reset_adjustments=True, ffmpeg="ffmpeg")

            self.assertEqual(result["stats"]["video_success"], 1)
            self.assertEqual(
                apply.call_args.args[1],
                earlier.model_copy(update={"adjust": ColorAdjust(), "auto_adjust": None}),
            )
            self.assertEqual(apply.call_args.kwargs["ffmpeg"], "ffmpeg")
            analyse.assert_not_called()
            probe.assert_not_called()

    def test_reads_the_kept_range_and_renders_the_suggestion(self, analyse, _probe) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root)
            write_spec(media, VideoEditSpec(trim_start=2.0, trim_end=6.0))

            with patch("automation.auto_adjust.apply_video_edit") as apply:
                result = run_auto_adjust_job(root, ffmpeg="ffmpeg")

            self.assertEqual(result["stats"]["video_success"], 1)
            self.assertEqual(analyse.call_args.kwargs, {"start": 2.0, "end": 6.0, "duration": 10.0})
            spec = apply.call_args.args[1]
            self.assertEqual((spec.trim_start, spec.trim_end), (2.0, 6.0))
            self.assertEqual(spec.adjust, suggest_adjust(DARK_PIXELS, np.ones(64)))

    def test_a_failed_render_leaves_the_edit_as_it_was(self, _analyse, _probe) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root)

            with patch(
                "automation.auto_adjust.apply_video_edit", side_effect=RuntimeError("ffmpeg failed")
            ):
                result = run_auto_adjust_job(root, ffmpeg="ffmpeg")

            self.assertEqual(result["stats"]["ffmpeg_error"], 1)
            self.assertIsNone(read_edit_spec(media))

    def test_a_cancelled_render_stops_the_run(self, _analyse, _probe) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "first.mp4")
            write_mp4_video(root, "second.mp4")

            with patch("automation.auto_adjust.apply_video_edit", side_effect=FfmpegCancelled):
                result = run_auto_adjust_job(root, ffmpeg="ffmpeg")

            self.assertEqual(result["stats"]["cancelled"], 2)
            self.assertEqual(len(results_by_name(result)), 1)


class ValidationTests(unittest.TestCase):
    def test_a_folder_without_editable_media_is_refused(self) -> None:
        with TempMediaFolder() as root:
            (root / "clip.gif").write_bytes(b"GIF89a")

            with self.assertRaisesRegex(ValueError, "No JPG, PNG"):
                validate_auto_adjust_folder(root)

    def test_a_missing_folder_is_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "Folder not found"):
            validate_auto_adjust_folder(Path("missing-folder"))


if __name__ == "__main__":
    unittest.main()
