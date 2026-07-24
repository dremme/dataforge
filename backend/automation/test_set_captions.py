"""Unit tests for automation.set_captions."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.set_captions import (
    list_set_captions_media,
    run_set_captions_job,
    validate_set_captions_folder,
)
from testing_fixtures import (
    TempMediaFolder,
    write_json_caption,
    write_media,
    write_mp4_video,
    write_txt_caption,
)


class SetCaptionsMediaListingTests(unittest.TestCase):
    def test_lists_supported_images_and_videos(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")
            (root / "notes.txt").write_text("ignore", encoding="utf-8")

            names = [path.name for path in list_set_captions_media(root)]

            self.assertEqual(names, ["clip.mp4", "photo.png"])

    def test_validate_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_set_captions_folder(root)


class SetCaptionsJobTests(unittest.TestCase):
    def test_writes_txt_sidecars_for_uncaptioned_media(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")

            result = run_set_captions_job(root, "Shared caption.")

            self.assertEqual(result["total"], 2)
            self.assertEqual(result["stats"]["success"], 2)
            self.assertEqual(
                first.with_suffix(".txt").read_text(encoding="utf-8").strip(),
                "Shared caption.",
            )
            self.assertEqual(
                second.with_suffix(".txt").read_text(encoding="utf-8").strip(),
                "Shared caption.",
            )

    def test_skips_existing_captions_without_overwrite(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Keep me.")

            result = run_set_captions_job(root, "Replace me.", overwrite=False)

            self.assertEqual(result["stats"]["skipped"], 1)
            self.assertEqual(result["stats"]["success"], 0)
            self.assertEqual(media.with_suffix(".txt").read_text(encoding="utf-8"), "Keep me.")

    def test_overwrites_existing_txt_caption_when_requested(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Old caption.")

            result = run_set_captions_job(root, "New caption.", overwrite=True)

            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8").strip(),
                "New caption.",
            )

    def test_treats_existing_json_as_caption_without_overwrite(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_json_caption(media, {"high_level_description": "Existing JSON."})

            result = run_set_captions_job(root, "Ignored.", overwrite=False)

            self.assertEqual(result["stats"]["skipped"], 1)
            self.assertFalse(media.with_suffix(".txt").exists())

    def test_reports_write_errors(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with patch("automation.set_captions.save_caption", side_effect=OSError("disk full")):
                result = run_set_captions_job(root, "Caption text.", overwrite=True)

            self.assertEqual(result["stats"]["write_error"], 1)
            self.assertEqual(result["results"][0]["status"], "write_error")
            self.assertIn("disk full", str(result["results"][0]["message"]))


if __name__ == "__main__":
    unittest.main()
