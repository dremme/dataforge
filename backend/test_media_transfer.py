"""Tests for media move and copy helpers."""

from __future__ import annotations

import os
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from captions import issue_file_path
from media_transfer import preview_media_transfer, transfer_media_with_sidecars
from testing_fixtures import (
    TempMediaFolder,
    write_json_caption,
    write_media,
    write_mp4_video,
    write_txt_caption,
)


class PreviewMediaTransferTests(unittest.TestCase):
    def test_detects_conflicts_and_eligible_files(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            write_media(source_dir, "sunset.png")
            write_media(source_dir, "beach.jpg")
            write_media(destination_dir, "sunset.png")

            preview = preview_media_transfer(
                destination_dir,
                [source_dir / "sunset.png", source_dir / "beach.jpg"],
            )

            self.assertEqual(preview["eligible"], ["beach.jpg"])
            self.assertEqual(preview["conflicts"], ["sunset.png"])
            self.assertEqual(preview["skipped"], [])

    def test_skips_files_already_in_destination_folder(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            preview = preview_media_transfer(root, [media])

            self.assertEqual(preview["eligible"], [])
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
            issue_file_path(media).write_text('{"fixes":["old"]}', encoding="utf-8")

            result = transfer_media_with_sidecars(media, destination_dir, mode="move")

            destination_media = destination_dir / "sunset.png"
            self.assertTrue(destination_media.is_file())
            self.assertFalse(media.exists())
            self.assertTrue((destination_dir / "sunset.txt").is_file())
            self.assertTrue((destination_dir / "sunset.json").is_file())
            self.assertTrue((destination_dir / "sunset.png.issue.json").is_file())
            self.assertFalse(media.with_suffix(".txt").exists())
            self.assertFalse(media.with_suffix(".json").exists())
            self.assertFalse(issue_file_path(media).exists())
            self.assertEqual(result["source"], str(media))
            self.assertEqual(result["destination"], str(destination_media))
            self.assertEqual(
                set(result["files"]),
                {"sunset.png", "sunset.txt", "sunset.json", "sunset.png.issue.json"},
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
                transfer_media_with_sidecars(source, destination_dir, mode="move")

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

            with patch("media_transfer.os.replace", _blocking_replace("sunset.png")):
                with self.assertRaises(HTTPException) as ctx:
                    transfer_media_with_sidecars(media, destination_dir, mode="move")

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

            with patch("media_transfer.os.replace", _blocking_replace("sunset.txt")):
                with self.assertRaises(HTTPException) as ctx:
                    transfer_media_with_sidecars(media, destination_dir, mode="move")

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

            with patch("media_transfer.os.replace", _blocking_replace("sunset.png")):
                with self.assertRaises(HTTPException):
                    transfer_media_with_sidecars(
                        media, destination_dir, overwrite=True, mode="move"
                    )

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
            issue_file_path(existing).write_text('{"fixes":["stale"]}', encoding="utf-8")

            transfer_media_with_sidecars(media, destination_dir, overwrite=True, mode="move")

            self.assertEqual(
                (destination_dir / "sunset.txt").read_text(encoding="utf-8"),
                "Golden hour.",
            )
            self.assertFalse(issue_file_path(destination_dir / "sunset.png").exists())


class CopyMediaWithSidecarsTests(unittest.TestCase):
    def _folders(self, root: Path) -> tuple[Path, Path]:
        source_dir = root / "Source"
        destination_dir = root / "Destination"
        source_dir.mkdir()
        destination_dir.mkdir()
        return source_dir, destination_dir

    def test_copies_media_and_sidecars_and_keeps_the_originals(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = self._folders(root)

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")
            write_json_caption(media, {"description": "Golden hour."})
            issue_file_path(media).write_text('{"fixes":["old"]}', encoding="utf-8")

            result = transfer_media_with_sidecars(media, destination_dir, mode="copy")

            for name in ("sunset.png", "sunset.txt", "sunset.json", "sunset.png.issue.json"):
                self.assertTrue((destination_dir / name).is_file(), name)
                self.assertTrue((source_dir / name).is_file(), f"original {name} was removed")

            self.assertEqual(
                (destination_dir / "sunset.txt").read_text(encoding="utf-8"),
                "Golden hour.",
            )
            self.assertEqual(result["destination"], str(destination_dir / "sunset.png"))
            self.assertEqual(
                set(result["files"]),
                {"sunset.png", "sunset.txt", "sunset.json", "sunset.png.issue.json"},
            )

    def test_rejects_copy_without_overwrite_when_destination_exists(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = self._folders(root)

            media = write_media(source_dir, "sunset.png")
            write_media(destination_dir, "sunset.png")

            with self.assertRaises(HTTPException) as caught:
                transfer_media_with_sidecars(media, destination_dir, mode="copy")

            self.assertEqual(caught.exception.status_code, 409)
            self.assertTrue(media.is_file())

    def test_rejects_copying_into_the_same_folder(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with self.assertRaises(HTTPException) as caught:
                transfer_media_with_sidecars(media, root, mode="copy")

            self.assertEqual(caught.exception.status_code, 400)

    def test_a_failed_sidecar_copy_leaves_nothing_behind(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = self._folders(root)

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")

            real_copy = shutil.copy2

            def failing_copy(source, destination, *args, **kwargs):
                if Path(source).suffix == ".txt":
                    raise OSError("sidecar is locked")
                return real_copy(source, destination, *args, **kwargs)

            with patch("media_transfer.shutil.copy2", failing_copy):
                with self.assertRaises(HTTPException):
                    transfer_media_with_sidecars(media, destination_dir, mode="copy")

            # The half-written group is rolled back, and the originals are untouched.
            self.assertFalse((destination_dir / "sunset.png").exists())
            self.assertFalse((destination_dir / "sunset.txt").exists())
            self.assertTrue(media.is_file())
            self.assertTrue(media.with_suffix(".txt").is_file())

    def test_replacing_drops_sidecars_the_source_does_not_have(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = self._folders(root)

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")
            existing = write_media(destination_dir, "sunset.png")
            issue_file_path(existing).write_text('{"fixes":["stale"]}', encoding="utf-8")

            transfer_media_with_sidecars(media, destination_dir, overwrite=True, mode="copy")

            self.assertEqual(
                (destination_dir / "sunset.txt").read_text(encoding="utf-8"),
                "Golden hour.",
            )
            self.assertFalse(issue_file_path(destination_dir / "sunset.png").exists())
            self.assertTrue(media.is_file())


class TransferVideoEditSidecarTests(unittest.TestCase):
    def test_a_moved_video_keeps_the_original_it_can_be_reverted_to(self) -> None:
        with TempMediaFolder() as root:
            source_folder = root / "source"
            destination = root / "destination"
            source_folder.mkdir()
            destination.mkdir()
            media = write_mp4_video(source_folder, "clip.mp4")
            (source_folder / "clip.mp4.bak").write_bytes(b"pristine-original")
            (source_folder / "clip.edit.json").write_text("{}", encoding="utf-8")

            result = transfer_media_with_sidecars(media, destination, mode="move")

            self.assertEqual(set(result["files"]), {"clip.mp4", "clip.mp4.bak", "clip.edit.json"})
            self.assertEqual((destination / "clip.mp4.bak").read_bytes(), b"pristine-original")
            self.assertEqual(list(source_folder.glob("*")), [])


if __name__ == "__main__":
    unittest.main()
