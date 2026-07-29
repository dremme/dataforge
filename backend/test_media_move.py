"""Tests for media move helpers."""

from __future__ import annotations

import unittest

from fastapi import HTTPException

from captions import issue_file_path
from media_move import move_media_with_sidecars, preview_media_move
from testing_fixtures import (
    TempMediaFolder,
    write_json_caption,
    write_media,
    write_txt_caption,
)


class PreviewMediaMoveTests(unittest.TestCase):
    def test_detects_conflicts_and_movable_files(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            write_media(source_dir, "sunset.png")
            write_media(source_dir, "beach.jpg")
            write_media(destination_dir, "sunset.png")

            preview = preview_media_move(
                destination_dir,
                [source_dir / "sunset.png", source_dir / "beach.jpg"],
            )

            self.assertEqual(preview["movable"], ["beach.jpg"])
            self.assertEqual(preview["conflicts"], ["sunset.png"])
            self.assertEqual(preview["skipped"], [])

    def test_skips_files_already_in_destination_folder(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            preview = preview_media_move(root, [media])

            self.assertEqual(preview["movable"], [])
            self.assertEqual(preview["conflicts"], [])
            self.assertEqual(preview["skipped"], [str(media.resolve())])


class MoveMediaWithSidecarsTests(unittest.TestCase):
    def test_moves_media_and_sidecars(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")
            write_json_caption(media, {"description": "Golden hour."})
            issue_file_path(media).write_text('{"issues":"old"}', encoding="utf-8")

            result = move_media_with_sidecars(media, destination_dir)

            destination_media = destination_dir / "sunset.png"
            self.assertTrue(destination_media.is_file())
            self.assertFalse(media.exists())
            self.assertTrue((destination_dir / "sunset.txt").is_file())
            self.assertTrue((destination_dir / "sunset.json").is_file())
            self.assertTrue((destination_dir / "sunset.issue.json").is_file())
            self.assertFalse(media.with_suffix(".txt").exists())
            self.assertFalse(media.with_suffix(".json").exists())
            self.assertFalse(issue_file_path(media).exists())
            self.assertEqual(result["source"], str(media))
            self.assertEqual(result["destination"], str(destination_media))
            self.assertEqual(
                set(result["moved"]),
                {"sunset.png", "sunset.txt", "sunset.json", "sunset.issue.json"},
            )

    def test_rejects_move_without_overwrite_when_destination_exists(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            source = write_media(source_dir, "sunset.png")
            write_media(destination_dir, "sunset.png")

            with self.assertRaises(HTTPException) as ctx:
                move_media_with_sidecars(source, destination_dir)

            self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
