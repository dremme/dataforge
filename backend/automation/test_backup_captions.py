"""Unit tests for backing up caption sidecars and restoring them."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from automation.backup_captions import (
    backed_up_media_stem,
    caption_backup_dir,
    has_caption_backup,
    list_backup_sidecars,
    media_sidecars,
    run_backup_captions_job,
    run_restore_captions_job,
    validate_backup_captions_folder,
    validate_restore_captions_folder,
)
from captions import issue_file_path
from constants import CAPTION_BACKUP_DIR_NAME
from testing_fixtures import (
    TempMediaFolder,
    write_issue_sidecar,
    write_json_caption,
    write_media,
    write_txt_caption,
)


class MediaSidecarTests(unittest.TestCase):
    def test_collects_both_suffixes_with_json_first(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            write_json_caption(media, {"description": "A structured caption."})

            self.assertEqual(
                [path.name for path in media_sidecars(media)],
                ["sunset.json", "sunset.txt"],
            )

    def test_collects_the_issue_sidecar_too(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            write_issue_sidecar(media, "The caption omits the mountains.")

            self.assertEqual(
                [path.name for path in media_sidecars(media)],
                ["sunset.txt", "sunset.issue.json"],
            )

    def test_returns_empty_without_captions(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            self.assertEqual(media_sidecars(media), [])


class BackedUpMediaStemTests(unittest.TestCase):
    def test_strips_the_double_issue_suffix(self) -> None:
        self.assertEqual(backed_up_media_stem(Path("sunset.issue.json")), "sunset")

    def test_strips_a_single_caption_suffix(self) -> None:
        self.assertEqual(backed_up_media_stem(Path("sunset.json")), "sunset")
        self.assertEqual(backed_up_media_stem(Path("sunset.txt")), "sunset")

    def test_keeps_dots_that_belong_to_the_stem(self) -> None:
        self.assertEqual(backed_up_media_stem(Path("my.sunset.issue.json")), "my.sunset")
        self.assertEqual(backed_up_media_stem(Path("my.sunset.txt")), "my.sunset")


class BackupCaptionsJobTests(unittest.TestCase):
    def test_validate_requires_a_caption_to_back_up(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "sunset.png")

            with self.assertRaisesRegex(ValueError, "No captions found to back up"):
                validate_backup_captions_folder(root)

    def test_copies_every_caption_sidecar_into_the_backup_folder(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "sunset.png")
            write_txt_caption(first, "A plain caption.")
            write_json_caption(first, {"description": "A structured caption."})
            second = write_media(root, "harbor.png")
            write_txt_caption(second, "Boats at rest.")
            write_media(root, "no_caption.png")

            result = run_backup_captions_job(root)

            backup_dir = caption_backup_dir(root)
            self.assertEqual(
                {path.name for path in backup_dir.iterdir()},
                {"sunset.json", "sunset.txt", "harbor.txt"},
            )
            self.assertEqual(
                backup_dir.joinpath("harbor.txt").read_text(encoding="utf-8"),
                "Boats at rest.",
            )

            stats = result["stats"]
            self.assertEqual(stats["success"], 2)
            self.assertEqual(stats["sidecars"], 3)
            self.assertEqual(stats["skipped"], 1)
            self.assertEqual(stats["write_error"], 0)

    def test_copies_caption_issue_sidecars(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            write_issue_sidecar(media, "The caption omits the mountains.")

            result = run_backup_captions_job(root)

            self.assertEqual(
                {path.name for path in caption_backup_dir(root).iterdir()},
                {"sunset.txt", "sunset.issue.json"},
            )
            self.assertEqual(result["stats"]["sidecars"], 2)

    def test_backs_up_an_issue_sidecar_without_a_caption(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, "There is no caption at all.")

            run_backup_captions_job(root)

            self.assertEqual(
                {path.name for path in caption_backup_dir(root).iterdir()},
                {"sunset.issue.json"},
            )

    def test_backing_up_again_refreshes_the_stored_copy(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "First caption.")
            run_backup_captions_job(root)

            write_txt_caption(media, "Second caption.")
            run_backup_captions_job(root)

            self.assertEqual(
                caption_backup_dir(root).joinpath("sunset.txt").read_text(encoding="utf-8"),
                "Second caption.",
            )

    def test_honours_a_media_selection(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "sunset.png")
            write_txt_caption(first, "A plain caption.")
            second = write_media(root, "harbor.png")
            write_txt_caption(second, "Boats at rest.")

            run_backup_captions_job(root, selected_paths=[first])

            self.assertEqual(
                {path.name for path in caption_backup_dir(root).iterdir()},
                {"sunset.txt"},
            )

    def test_the_backup_folder_is_not_treated_as_a_subfolder(self) -> None:
        from filesystem import list_subfolders

        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            run_backup_captions_job(root)

            names = {entry["name"] for entry in list_subfolders(root)}
            self.assertNotIn(CAPTION_BACKUP_DIR_NAME, names)


class HasCaptionBackupTests(unittest.TestCase):
    def test_false_without_a_backup_folder(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "sunset.png")

            self.assertFalse(has_caption_backup(root))

    def test_true_once_a_caption_is_backed_up(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            run_backup_captions_job(root)

            self.assertTrue(has_caption_backup(root))

    def test_false_when_the_backup_holds_no_caption_files(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "sunset.png")
            backup_dir = caption_backup_dir(root)
            backup_dir.mkdir()
            backup_dir.joinpath("notes.md").write_text("ignore", encoding="utf-8")

            self.assertFalse(has_caption_backup(root))

    def test_survives_a_listing_that_fails_only_once_iterated(self) -> None:
        """Python 3.12's ``iterdir`` is a generator, so it raises on iteration.

        Guarding just the ``iterdir()`` call is therefore a no-op on 3.12 while
        looking correct on 3.13, where the scan happens eagerly.
        """

        def lazily_failing_iterdir(self: Path):
            raise FileNotFoundError(2, "No such file or directory", str(self))
            yield  # pragma: no cover - makes this a generator function

        with TempMediaFolder() as root:
            write_media(root, "sunset.png")

            with patch.object(Path, "iterdir", lazily_failing_iterdir):
                self.assertFalse(has_caption_backup(root))


class RestoreCaptionsJobTests(unittest.TestCase):
    def test_validate_requires_an_existing_backup(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "sunset.png")

            with self.assertRaisesRegex(ValueError, "No caption backup found"):
                validate_restore_captions_folder(root)

    def test_restores_captions_over_the_current_ones(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Original caption.")
            run_backup_captions_job(root)

            write_txt_caption(media, "Edited by mistake.")

            result = run_restore_captions_job(root)

            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8"),
                "Original caption.",
            )
            self.assertEqual(result["stats"]["success"], 1)

    def test_restores_a_caption_that_was_deleted(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_json_caption(media, {"description": "A structured caption."})
            run_backup_captions_job(root)

            media.with_suffix(".json").unlink()

            run_restore_captions_job(root)

            self.assertTrue(media.with_suffix(".json").is_file())

    def test_restores_a_caption_issue_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            issue_path = write_issue_sidecar(media, "The caption omits the mountains.")
            run_backup_captions_job(root)

            issue_path.unlink()

            result = run_restore_captions_job(root)

            self.assertTrue(issue_path.is_file())
            self.assertIn("omits the mountains", issue_path.read_text(encoding="utf-8"))
            self.assertEqual(result["stats"]["orphaned"], 0)
            self.assertEqual(result["stats"]["success"], 2)

    def test_restoring_an_issue_sidecar_makes_the_issue_visible_again(self) -> None:
        from captions import load_issue_summary

        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            write_issue_sidecar(media, "The caption omits the mountains.")
            run_backup_captions_job(root)

            issue_file_path(media).unlink()
            self.assertEqual(load_issue_summary(media), ([], False))

            run_restore_captions_job(root)

            fixes, has_issue_file = load_issue_summary(media)
            self.assertEqual(fixes, ["The caption omits the mountains."])
            self.assertTrue(has_issue_file)

    def test_honours_a_selection_for_issue_sidecars(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "sunset.png")
            write_issue_sidecar(first, "Sunset issue.")
            second = write_media(root, "harbor.png")
            write_issue_sidecar(second, "Harbor issue.")
            run_backup_captions_job(root)

            issue_file_path(first).unlink()
            issue_file_path(second).unlink()

            run_restore_captions_job(root, selected_paths=[first])

            self.assertTrue(issue_file_path(first).is_file())
            self.assertFalse(issue_file_path(second).exists())

    def test_skips_backed_up_captions_without_media(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            run_backup_captions_job(root)

            backup_dir = caption_backup_dir(root)
            backup_dir.joinpath("gone.txt").write_text("Orphan.", encoding="utf-8")

            result = run_restore_captions_job(root)

            self.assertFalse((root / "gone.txt").exists())
            self.assertEqual(result["stats"]["orphaned"], 1)
            self.assertEqual(result["stats"]["success"], 1)

    def test_leaves_captions_outside_the_backup_untouched(self) -> None:
        with TempMediaFolder() as root:
            backed_up = write_media(root, "sunset.png")
            write_txt_caption(backed_up, "Original caption.")
            run_backup_captions_job(root)

            later = write_media(root, "harbor.png")
            write_txt_caption(later, "Added after the backup.")

            run_restore_captions_job(root)

            self.assertEqual(
                later.with_suffix(".txt").read_text(encoding="utf-8"),
                "Added after the backup.",
            )

    def test_lists_only_caption_files_from_the_backup_folder(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            run_backup_captions_job(root)

            backup_dir = caption_backup_dir(root)
            backup_dir.joinpath("notes.md").write_text("ignore", encoding="utf-8")

            self.assertEqual(
                [path.name for path in list_backup_sidecars(root)],
                ["sunset.txt"],
            )

    def test_honours_a_media_selection(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "sunset.png")
            write_txt_caption(first, "Original sunset.")
            second = write_media(root, "harbor.png")
            write_txt_caption(second, "Original harbor.")
            run_backup_captions_job(root)

            write_txt_caption(first, "Edited sunset.")
            write_txt_caption(second, "Edited harbor.")

            run_restore_captions_job(root, selected_paths=[first])

            self.assertEqual(
                first.with_suffix(".txt").read_text(encoding="utf-8"),
                "Original sunset.",
            )
            self.assertEqual(
                second.with_suffix(".txt").read_text(encoding="utf-8"),
                "Edited harbor.",
            )


if __name__ == "__main__":
    unittest.main()
