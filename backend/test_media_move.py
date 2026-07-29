"""Tests for media move helpers."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

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


def _blocking_replace(blocked: str):
    """Stand in for ``os.replace`` refusing one name, the way a locked file does."""
    real_replace = os.replace

    def replace(source, destination):
        if Path(source).name == blocked:
            raise PermissionError(f"{blocked} is used by another process")
        real_replace(source, destination)

    return replace


class AbortedMoveTests(unittest.TestCase):
    """A move that cannot finish must leave both folders exactly as it found them."""

    def test_unmovable_media_leaves_no_copy_in_the_destination(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")

            with patch("media_move.os.replace", _blocking_replace("sunset.png")):
                with self.assertRaises(HTTPException) as ctx:
                    move_media_with_sidecars(media, destination_dir)

            self.assertEqual(ctx.exception.status_code, 500)
            self.assertTrue(media.is_file())
            self.assertTrue(media.with_suffix(".txt").is_file())
            self.assertFalse((destination_dir / "sunset.png").exists())
            self.assertFalse((destination_dir / "sunset.txt").exists())

    def test_unmovable_sidecar_restores_the_media_file(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")

            with patch("media_move.os.replace", _blocking_replace("sunset.txt")):
                with self.assertRaises(HTTPException) as ctx:
                    move_media_with_sidecars(media, destination_dir)

            self.assertEqual(ctx.exception.status_code, 500)
            self.assertTrue(media.is_file())
            self.assertTrue(media.with_suffix(".txt").is_file())
            self.assertFalse((destination_dir / "sunset.png").exists())
            self.assertFalse((destination_dir / "sunset.txt").exists())

    def test_aborted_replace_keeps_the_destination_caption(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")
            existing = write_media(destination_dir, "sunset.png")
            write_txt_caption(existing, "The caption already in the dataset.")

            with patch("media_move.os.replace", _blocking_replace("sunset.png")):
                with self.assertRaises(HTTPException):
                    move_media_with_sidecars(media, destination_dir, overwrite=True)

            self.assertEqual(
                (destination_dir / "sunset.txt").read_text(encoding="utf-8"),
                "The caption already in the dataset.",
            )

    def test_replacing_drops_sidecars_the_source_does_not_have(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")
            existing = write_media(destination_dir, "sunset.png")
            write_txt_caption(existing, "Stale.")
            issue_file_path(existing).write_text('{"issues":"stale"}', encoding="utf-8")

            move_media_with_sidecars(media, destination_dir, overwrite=True)

            self.assertEqual(
                (destination_dir / "sunset.txt").read_text(encoding="utf-8"),
                "Golden hour.",
            )
            self.assertFalse(issue_file_path(destination_dir / "sunset.png").exists())


if __name__ == "__main__":
    unittest.main()
