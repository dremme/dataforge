from __future__ import annotations

import errno
import os
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from candidate_pairing import candidate_path_for, candidate_sidecar_path
from captions import issue_file_path
from constants import CAPTION_BACKUP_DIR_NAME, STAGING_DIR_NAME
from media_transfer import preview_media_transfer, transfer_media_with_sidecars
from testing_fixtures import (
    TempMediaFolder,
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
            leftover = media.with_suffix(".json")
            leftover.write_text('{"description": "Golden hour."}\n', encoding="utf-8")
            issue_file_path(media).write_text('{"fixes":["old"]}', encoding="utf-8")

            result = transfer_media_with_sidecars(media, destination_dir, mode="move")

            destination_media = destination_dir / "sunset.png"
            self.assertTrue(destination_media.is_file())
            self.assertFalse(media.exists())
            self.assertTrue((destination_dir / "sunset.txt").is_file())
            self.assertFalse((destination_dir / "sunset.json").exists())
            self.assertTrue(leftover.is_file())
            self.assertTrue((destination_dir / "sunset.png.issue.json").is_file())
            self.assertFalse(media.with_suffix(".txt").exists())
            self.assertFalse(issue_file_path(media).exists())
            self.assertEqual(result["source"], str(media))
            self.assertEqual(result["destination"], str(destination_media))
            self.assertEqual(
                set(result["files"]),
                {"sunset.png", "sunset.txt", "sunset.png.issue.json"},
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
    real_replace = os.replace

    def replace(source, destination):
        if Path(source).name == blocked:
            raise PermissionError(f"{blocked} is used by another process")
        real_replace(source, destination)

    return replace


class AbortedMoveTests(unittest.TestCase):
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


class TransferRollbackTests(unittest.TestCase):
    def test_successful_overwrite_removes_temporary_backups(self) -> None:
        for mode in ("copy", "move"):
            with self.subTest(mode=mode), TempMediaFolder() as root:
                source_dir, destination_dir = root / "Source", root / "Destination"
                source_dir.mkdir()
                destination_dir.mkdir()
                media = write_media(source_dir, "sunset.png")
                write_txt_caption(media, "New caption.")
                expected = {path.name: path.read_bytes() for path in source_dir.iterdir()}
                for name in expected:
                    (destination_dir / name).write_bytes(b"original destination content")

                transfer_media_with_sidecars(media, destination_dir, mode=mode, overwrite=True)

                self.assertEqual(
                    {path.name: path.read_bytes() for path in destination_dir.iterdir()}, expected
                )
                self.assertEqual(
                    {path.name: path.read_bytes() for path in source_dir.iterdir()},
                    expected if mode == "copy" else {},
                )

    def test_failed_move_rollback_keeps_both_versions_recoverable(self) -> None:
        for block_source_restore in (False, True):
            with self.subTest(block_source_restore=block_source_restore):
                self._assert_failed_move_rollback_keeps_both_versions(block_source_restore)

    def _assert_failed_move_rollback_keeps_both_versions(self, block_source_restore: bool) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = root / "Source", root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()
            media = write_media(source_dir, "sunset.png")
            original_source = media.read_bytes()
            write_txt_caption(media, "New caption.")
            destination_media = destination_dir / media.name
            original_destination = b"original destination media"
            destination_media.write_bytes(original_destination)
            real_replace = os.replace

            def replace(source, destination):
                source, destination = Path(source), Path(destination)
                if source == media.with_suffix(".txt"):
                    raise PermissionError("Caption is locked")
                if block_source_restore and destination == media:
                    raise PermissionError("Source folder is locked")
                if not block_source_restore and source.name.startswith(".transfer-backup-"):
                    raise PermissionError("Destination folder is locked")
                return real_replace(source, destination)

            with (
                patch("media_transfer.os.replace", replace),
                self.assertLogs("media_transfer", level="WARNING"),
            ):
                with self.assertRaises(HTTPException):
                    transfer_media_with_sidecars(
                        media, destination_dir, mode="move", overwrite=True
                    )

            recovered_source = destination_media if block_source_restore else media
            self.assertEqual(recovered_source.read_bytes(), original_source)
            self.assertEqual(media.with_suffix(".txt").read_text(encoding="utf-8"), "New caption.")
            backups = list(destination_dir.glob(".transfer-backup-*"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), original_destination)

    def test_failed_overwrite_preserves_both_complete_groups(self) -> None:
        for mode, cross_volume in (("copy", False), ("move", False), ("move", True)):
            with self.subTest(mode=mode, cross_volume=cross_volume):
                self._assert_failed_overwrite_preserves_both_groups(mode, cross_volume)

    def _assert_failed_overwrite_preserves_both_groups(self, mode, cross_volume: bool) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = root / "Source", root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()
            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "New caption.")
            issue_file_path(media).write_bytes(b"new issue")
            existing = destination_dir / media.name
            existing.write_bytes(b"original destination media")
            write_txt_caption(existing, "Original caption.")
            issue_file_path(existing).write_bytes(b"original issue")
            before = {
                path.relative_to(root): path.read_bytes()
                for path in root.rglob("*")
                if path.is_file()
            }
            real_replace, real_copy = os.replace, shutil.copy2

            def replace(source, destination):
                source, destination = Path(source), Path(destination)
                if cross_volume and {source.parent, destination.parent} == {
                    source_dir,
                    destination_dir,
                }:
                    raise OSError(errno.EXDEV, "Different volumes")
                if source == issue_file_path(media):
                    raise PermissionError("Issue sidecar is locked")
                return real_replace(source, destination)

            def copy(source, destination, *args, **kwargs):
                if Path(source) == issue_file_path(media):
                    Path(destination).write_bytes(b"partial")
                    raise OSError(errno.ENOSPC, "Disk is full")
                return real_copy(source, destination, *args, **kwargs)

            with (
                patch("media_transfer.os.replace", replace),
                patch("media_transfer.shutil.copy2", copy),
            ):
                with self.assertRaises(HTTPException) as caught:
                    transfer_media_with_sidecars(media, destination_dir, mode=mode, overwrite=True)

            self.assertEqual(caught.exception.status_code, 500)
            after = {
                path.relative_to(root): path.read_bytes()
                for path in root.rglob("*")
                if path.is_file()
            }
            self.assertEqual(after, before)

    def test_partial_copy_failure_leaves_no_destination_files(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = root / "Source", root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()
            media = write_media(source_dir, "sunset.png")
            original = media.read_bytes()

            def copy(source, destination):
                Path(destination).write_bytes(b"partial")
                raise OSError(errno.ENOSPC, "Disk is full")

            with patch("media_transfer.shutil.copy2", copy):
                with self.assertRaises(HTTPException):
                    transfer_media_with_sidecars(media, destination_dir, mode="copy")

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(destination_dir.iterdir()), [])


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
            leftover = media.with_suffix(".json")
            leftover.write_text('{"description": "Golden hour."}\n', encoding="utf-8")
            issue_file_path(media).write_text('{"fixes":["old"]}', encoding="utf-8")

            result = transfer_media_with_sidecars(media, destination_dir, mode="copy")

            for name in ("sunset.png", "sunset.txt", "sunset.png.issue.json"):
                self.assertTrue((destination_dir / name).is_file(), name)
                self.assertTrue((source_dir / name).is_file(), f"original {name} was removed")

            self.assertTrue(leftover.is_file())
            self.assertFalse((destination_dir / "sunset.json").exists())
            self.assertEqual(
                (destination_dir / "sunset.txt").read_text(encoding="utf-8"),
                "Golden hour.",
            )
            self.assertEqual(result["destination"], str(destination_dir / "sunset.png"))
            self.assertEqual(
                set(result["files"]),
                {"sunset.png", "sunset.txt", "sunset.png.issue.json"},
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


def _with_backup_and_candidate(folder: Path) -> Path:
    media = write_media(folder, "photo.jpg")
    (folder / CAPTION_BACKUP_DIR_NAME).mkdir()
    (folder / CAPTION_BACKUP_DIR_NAME / "photo.txt").write_text("Original.", encoding="utf-8")
    (folder / STAGING_DIR_NAME).mkdir()
    candidate = write_media(folder / STAGING_DIR_NAME, "photo.png")
    candidate_sidecar_path(candidate).write_text("{}", encoding="utf-8")
    return media


class TransferNameLinkedFilesTests(unittest.TestCase):
    def test_move_takes_the_backup_caption_and_candidate_along(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = root / "Source", root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()
            media = _with_backup_and_candidate(source_dir)

            transfer_media_with_sidecars(media, destination_dir, mode="move")

            moved = destination_dir / "photo.jpg"
            self.assertEqual(
                (destination_dir / CAPTION_BACKUP_DIR_NAME / "photo.txt").read_text(
                    encoding="utf-8"
                ),
                "Original.",
            )
            self.assertEqual(
                candidate_path_for(moved), destination_dir / STAGING_DIR_NAME / "photo.png"
            )
            self.assertTrue(
                candidate_sidecar_path(destination_dir / STAGING_DIR_NAME / "photo.png").is_file()
            )
            self.assertFalse((source_dir / CAPTION_BACKUP_DIR_NAME / "photo.txt").exists())
            self.assertFalse((source_dir / STAGING_DIR_NAME / "photo.png").exists())

    def test_copy_leaves_the_source_group_intact(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = root / "Source", root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()
            media = _with_backup_and_candidate(source_dir)

            transfer_media_with_sidecars(media, destination_dir, mode="copy")

            self.assertTrue((source_dir / STAGING_DIR_NAME / "photo.png").is_file())
            self.assertTrue((destination_dir / STAGING_DIR_NAME / "photo.png").is_file())
            self.assertTrue((destination_dir / CAPTION_BACKUP_DIR_NAME / "photo.txt").is_file())

    def test_refuses_when_a_destination_file_would_claim_the_candidate(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = root / "Source", root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()
            media = _with_backup_and_candidate(source_dir)
            write_media(destination_dir, "photo.png")

            with self.assertRaises(HTTPException) as caught:
                transfer_media_with_sidecars(media, destination_dir, mode="move")

            self.assertEqual(caught.exception.status_code, 409)
            self.assertTrue(media.is_file())

    def test_a_failed_move_removes_the_subfolders_it_created(self) -> None:
        with TempMediaFolder() as root:
            source_dir, destination_dir = root / "Source", root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()
            media = _with_backup_and_candidate(source_dir)

            with patch("media_transfer.os.replace", _blocking_replace("photo.png")):
                with self.assertRaises(HTTPException):
                    transfer_media_with_sidecars(media, destination_dir, mode="move")

            self.assertTrue(media.is_file())
            self.assertTrue((source_dir / CAPTION_BACKUP_DIR_NAME / "photo.txt").is_file())
            self.assertFalse((destination_dir / STAGING_DIR_NAME).exists())
            self.assertFalse((destination_dir / CAPTION_BACKUP_DIR_NAME).exists())


if __name__ == "__main__":
    unittest.main()
