from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import errno
import shutil
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

from automation.backup_captions import run_backup_captions_job, run_restore_captions_job
from automation.edit_captions import back_up_caption_sidecars
from automation.rename_media import run_rename_media_job
from captions import save_caption, save_issue_findings
from comfy_candidates import write_candidate_sidecar
from constants import CAPTION_BACKUP_DIR_NAME, SYSPROMPT_FILENAME
from duplicates import DuplicateFinding, save_duplicate_finding
from edit_sidecars import write_spec
from file_write import copy_file_atomic, write_text_atomic
from folder_instructions import save_instruction_file
from schemas import ComfyCandidateSidecar, ImageEditSpec
from testing_fixtures import TempMediaFolder, write_media, write_txt_caption


def _snapshot(folder: Path) -> dict[Path, bytes]:
    return {
        path.relative_to(folder): path.read_bytes() for path in folder.rglob("*") if path.is_file()
    }


def _failed_text_write(path: Path, *args, **kwargs) -> None:
    path.write_bytes(b"partial")
    raise OSError(errno.ENOSPC, "Disk is full")


def _failed_copy(source, destination, *args, **kwargs) -> None:
    Path(destination).write_bytes(b"partial")
    raise OSError(errno.ENOSPC, "Disk is full")


class SidecarWriteSafetyTests(unittest.TestCase):
    def test_failed_writes_preserve_existing_sidecars(self) -> None:
        writers: dict[str, Callable[[Path], object]] = {
            "caption": lambda media: save_caption(media, "A landscape."),
            "issue": lambda media: save_issue_findings(media, "fixes", ["Describe the trees."]),
            "duplicate": lambda media: save_duplicate_finding(
                media, DuplicateFinding("sample", 1, "8")
            ),
            "instructions": lambda media: save_instruction_file(
                media.parent, SYSPROMPT_FILENAME, "Describe the scene."
            ),
            "edit": lambda media: write_spec(media, ImageEditSpec(rotate=90)),
            "candidate": lambda media: write_candidate_sidecar(
                media,
                ComfyCandidateSidecar(
                    source_name=media.name, preset="sample", created_at="2026-01-01T00:00:00.000Z"
                ),
            ),
        }
        for name, writer in writers.items():
            with self.subTest(writer=name):
                self._assert_failed_write_preserves_files(writer)

    def _assert_failed_write_preserves_files(self, writer: Callable[[Path], object]) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "landscape.png")
            writer(media)
            before = _snapshot(root)

            with patch.object(Path, "write_text", _failed_text_write):
                with self.assertRaises(OSError):
                    writer(media)

            self.assertEqual(_snapshot(root), before)


class CaptionBackupWriteSafetyTests(unittest.TestCase):
    def test_failed_backup_overwrite_preserves_previous_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "landscape.png")
            write_txt_caption(media, "A landscape.")
            run_backup_captions_job(root)
            write_txt_caption(media, "An updated landscape.")
            before = _snapshot(root)

            with patch("shutil.copy2", _failed_copy):
                result = run_backup_captions_job(root, overwrite=True)

            self.assertEqual(result["stats"]["write_error"], 1)
            self.assertEqual(_snapshot(root), before)

    def test_failed_restore_preserves_current_caption(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "landscape.png")
            write_txt_caption(media, "A landscape.")
            run_backup_captions_job(root)
            write_txt_caption(media, "An updated landscape.")
            before = _snapshot(root)

            with patch("shutil.copy2", _failed_copy):
                result = run_restore_captions_job(root)

            self.assertEqual(result["stats"]["write_error"], 1)
            self.assertEqual(_snapshot(root), before)

    def test_failed_automatic_backup_does_not_poison_the_next_attempt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "landscape.png")
            caption = write_txt_caption(media, "A landscape.")
            backup_dir = root / CAPTION_BACKUP_DIR_NAME
            backup_dir.mkdir()

            with patch("shutil.copy2", _failed_copy):
                with self.assertRaises(OSError):
                    back_up_caption_sidecars(media, backup_dir)

            self.assertEqual(list(backup_dir.iterdir()), [])
            back_up_caption_sidecars(media, backup_dir)
            self.assertEqual((backup_dir / caption.name).read_bytes(), caption.read_bytes())


class RenameFailureSafetyTests(unittest.TestCase):
    def test_partial_group_failure_restores_original_names(self) -> None:
        for phase in (1, 2):
            with self.subTest(phase=phase):
                self._assert_rename_failure_restores_original_names(phase)

    def _assert_rename_failure_restores_original_names(self, phase: int) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "landscape.png")
            write_txt_caption(media, "A landscape.")
            before = _snapshot(root)
            real_rename = Path.rename

            def rename(source, destination):
                destination = Path(destination)
                if source.suffix == ".txt" and (
                    (phase == 1 and source.stem == media.stem)
                    or (phase == 2 and destination.stem == "sample_001")
                ):
                    raise PermissionError("Caption is locked")
                return real_rename(source, destination)

            with patch.object(Path, "rename", rename):
                result = run_rename_media_job(root, stem="sample")

            self.assertEqual(result["stats"]["rename_error"], 1)
            self.assertEqual(_snapshot(root), before)


class AtomicPublicationTests(unittest.TestCase):
    def test_failed_publication_preserves_existing_file_and_cleans_temporary_files(self) -> None:
        writers: dict[str, Callable[[Path], object]] = {
            "text": lambda destination: write_text_atomic(destination, "New caption."),
            "copy": lambda destination: copy_file_atomic(
                destination.with_name("source.txt"), destination
            ),
        }
        for name, writer in writers.items():
            with self.subTest(writer=name), TempMediaFolder() as root:
                (root / "source.txt").write_text("New caption.", encoding="utf-8")
                destination = root / "landscape.txt"
                destination.write_text("Original caption.", encoding="utf-8")
                before = _snapshot(root)

                with patch("file_write.os.replace", side_effect=PermissionError("File is locked")):
                    with self.assertRaises(PermissionError):
                        writer(destination)

                self.assertEqual(_snapshot(root), before)

    def test_backup_created_during_copy_is_preserved_without_overwrite(self) -> None:
        with TempMediaFolder() as root:
            source = root / "source.txt"
            source.write_bytes(b"new caption")
            destination = root / "backup.txt"
            real_copy = shutil.copy2

            def copy(source, target):
                real_copy(source, target)
                destination.write_bytes(b"original caption")

            with patch("file_write.shutil.copy2", copy):
                copied = copy_file_atomic(source, destination, overwrite=False)

            self.assertFalse(copied)
            self.assertEqual(destination.read_bytes(), b"original caption")
            self.assertEqual(set(root.iterdir()), {source, destination})


if __name__ == "__main__":
    unittest.main()
