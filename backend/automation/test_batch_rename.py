"""Unit tests for automation.batch_rename."""

from __future__ import annotations

import os
import time
import unittest

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.batch_rename import (
    build_target_name,
    list_batch_rename_media,
    normalize_name_stem,
    run_batch_rename_job,
    sequence_padding,
    validate_batch_rename_folder,
)
from testing_fixtures import TempMediaFolder, write_media, write_mp4_video, write_txt_caption


class BatchRenameHelpersTests(unittest.TestCase):
    def test_sequence_padding_uses_at_least_three_digits(self) -> None:
        self.assertEqual(sequence_padding(3), 3)
        self.assertEqual(sequence_padding(99), 3)
        self.assertEqual(sequence_padding(100), 3)
        self.assertEqual(sequence_padding(1000), 4)

    def test_build_target_name(self) -> None:
        self.assertEqual(build_target_name("portugal", 1, 3, ".png"), "portugal_001.png")

    def test_normalize_name_stem_rejects_invalid_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot be empty"):
            normalize_name_stem("   ")
        with self.assertRaisesRegex(ValueError, "invalid characters"):
            normalize_name_stem("bad/name")


class BatchRenameMediaListingTests(unittest.TestCase):
    def test_lists_supported_media_oldest_to_newest(self) -> None:
        with TempMediaFolder() as root:
            older = write_media(root, "older.png")
            newer = write_media(root, "newer.png")
            write_mp4_video(root, "clip.mp4")
            (root / "notes.txt").write_text("ignore", encoding="utf-8")

            now = time.time()
            os.utime(older, (now - 20, now - 20))
            os.utime(newer, (now - 10, now - 10))

            names = [path.name for path in list_batch_rename_media(root)]

            self.assertEqual(names, ["older.png", "newer.png", "clip.mp4"])

    def test_validate_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No supported images or videos"):
                validate_batch_rename_folder(root, stem="sample")


class BatchRenameJobTests(unittest.TestCase):
    def test_renames_media_and_sidecars_with_numbered_stem(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "alpha.png")
            second = write_media(root, "beta.png")
            write_txt_caption(first, "Caption one.")

            now = time.time()
            os.utime(first, (now - 20, now - 20))
            os.utime(second, (now - 10, now - 10))

            result = run_batch_rename_job(root, stem="portugal")

            self.assertEqual(result["total"], 2)
            self.assertEqual(result["stats"]["success"], 2)
            self.assertTrue((root / "portugal_001.png").is_file())
            self.assertTrue((root / "portugal_002.png").is_file())
            self.assertEqual(
                (root / "portugal_001.txt").read_text(encoding="utf-8").strip(),
                "Caption one.",
            )
            self.assertFalse(first.exists())
            self.assertFalse(second.exists())

    def test_rejects_conflicting_target_names(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            (root / "portugal_001.png").mkdir()

            with self.assertRaisesRegex(ValueError, "already exists"):
                validate_batch_rename_folder(root, stem="portugal")

    def test_rejects_conflicting_target_names_for_selection(self) -> None:
        with TempMediaFolder() as root:
            selected = write_media(root, "photo.png")
            write_media(root, "keeper.png")
            # Non-selected media has the name that would be the target when only 1 file is selected.
            write_media(root, "portugal_001.png")

            # Full-folder validation may pass (overlaps a source that would move), but selection must reject.
            with self.assertRaisesRegex(ValueError, "already exists"):
                validate_batch_rename_folder(root, stem="portugal", selected_paths=[selected])

    def test_rejects_sidecar_target_conflict(self) -> None:
        with TempMediaFolder() as root:
            selected = write_media(root, "photo.png")
            write_txt_caption(selected, "sidecar content")
            # Existing file collides with the .txt sidecar target, not the media target.
            (root / "portugal_001.txt").write_text("colliding sidecar", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "already exists"):
                validate_batch_rename_folder(root, stem="portugal", selected_paths=[selected])

    def test_progress_advances_monotonically_across_both_rename_phases(self) -> None:
        with TempMediaFolder() as root:
            for name in ("a.png", "b.png", "c.png"):
                write_media(root, name)

            progress_samples: list[tuple[int, int]] = []

            def on_progress(
                _path: str,
                _name: str,
                processed: int,
                total: int,
                _stats: dict[str, int],
            ) -> None:
                progress_samples.append((processed, total))

            result = run_batch_rename_job(root, stem="sample", on_progress=on_progress)

            self.assertEqual(result["total"], 3)
            self.assertEqual(result["stats"]["success"], 3)
            # Two rename phases per file => progress total is 2N, steps 1..2N.
            self.assertEqual([total for _processed, total in progress_samples], [6] * 6)
            self.assertEqual(
                [processed for processed, _total in progress_samples], [1, 2, 3, 4, 5, 6]
            )
            processed_values = [processed for processed, _total in progress_samples]
            self.assertEqual(processed_values, sorted(processed_values))
