"""Unit tests for backing up caption sidecars and restoring them."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from automation.backup_captions import (
    caption_backup_dir,
    caption_sidecars,
    has_caption_backup,
    list_backup_sidecars,
    run_backup_captions_job,
    run_restore_captions_job,
    validate_backup_captions_folder,
    validate_restore_captions_folder,
)
from captions import issue_file_path, load_issue_summary
from constants import CAPTION_BACKUP_DIR_NAME
from testing_fixtures import (
    TempMediaFolder,
    write_issue_sidecar,
    write_media,
    write_txt_caption,
)


class CaptionSidecarTests(unittest.TestCase):
    def test_collects_txt_and_ignores_leftover_json(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            media.with_suffix(".json").write_text(
                '{"description": "A structured caption."}\n',
                encoding="utf-8",
            )

            self.assertEqual(
                [path.name for path in caption_sidecars(media)],
                ["sunset.txt"],
            )

    def test_leaves_findings_out(self) -> None:
        """A finding is derived from the caption; a job re-run is what restores it."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            write_issue_sidecar(media, "The caption omits the mountains.")

            self.assertEqual([path.name for path in caption_sidecars(media)], ["sunset.txt"])

    def test_returns_empty_without_captions(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            self.assertEqual(caption_sidecars(media), [])


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
            first.with_suffix(".json").write_text(
                '{"description": "A structured caption."}\n',
                encoding="utf-8",
            )
            second = write_media(root, "harbor.png")
            write_txt_caption(second, "Boats at rest.")
            write_media(root, "no_caption.png")

            result = run_backup_captions_job(root)

            backup_dir = caption_backup_dir(root)
            self.assertEqual(
                {path.name for path in backup_dir.iterdir()},
                {"sunset.txt", "harbor.txt"},
            )
            self.assertEqual(
                backup_dir.joinpath("harbor.txt").read_text(encoding="utf-8"),
                "Boats at rest.",
            )

            stats = result["stats"]
            self.assertEqual(stats["success"], 2)
            self.assertEqual(stats["sidecars"], 2)
            self.assertEqual(stats["skipped"], 1)
            self.assertEqual(stats["write_error"], 0)

    def test_stores_the_caption_and_not_the_findings_beside_it(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            write_issue_sidecar(media, "The caption omits the mountains.")

            result = run_backup_captions_job(root)

            self.assertEqual(
                {path.name for path in caption_backup_dir(root).iterdir()},
                {"sunset.txt"},
            )
            self.assertEqual(result["stats"]["sidecars"], 1)

    def test_a_file_carrying_only_findings_has_nothing_to_back_up(self) -> None:
        with TempMediaFolder() as root:
            captioned = write_media(root, "harbor.png")
            write_txt_caption(captioned, "A harbour at dusk.")
            media = write_media(root, "sunset.png")
            write_issue_sidecar(media, "There is no caption at all.")

            result = run_backup_captions_job(root)

            self.assertEqual(
                {path.name for path in caption_backup_dir(root).iterdir()},
                {"harbor.txt"},
            )
            self.assertEqual(result["stats"]["skipped"], 1)

    def test_backing_up_again_keeps_the_stored_copy(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "First caption.")
            run_backup_captions_job(root)

            write_txt_caption(media, "Second caption.")
            result = run_backup_captions_job(root)

            self.assertEqual(
                caption_backup_dir(root).joinpath("sunset.txt").read_text(encoding="utf-8"),
                "First caption.",
            )
            self.assertEqual(result["stats"]["already_backed_up"], 1)
            self.assertEqual(result["stats"]["success"], 0)

    def test_backing_up_with_overwrite_refreshes_the_stored_copy(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "First caption.")
            run_backup_captions_job(root)

            write_txt_caption(media, "Second caption.")
            result = run_backup_captions_job(root, overwrite=True)

            self.assertEqual(
                caption_backup_dir(root).joinpath("sunset.txt").read_text(encoding="utf-8"),
                "Second caption.",
            )
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["stats"]["already_backed_up"], 0)

    def test_backs_up_only_the_sidecars_that_are_missing(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "First caption.")
            run_backup_captions_job(root)

            write_txt_caption(media, "Second caption.")
            media.with_suffix(".json").write_text(
                '{"description": "A structured caption."}\n',
                encoding="utf-8",
            )
            result = run_backup_captions_job(root)

            backup_dir = caption_backup_dir(root)
            self.assertEqual(
                backup_dir.joinpath("sunset.txt").read_text(encoding="utf-8"),
                "First caption.",
            )
            self.assertFalse(backup_dir.joinpath("sunset.json").exists())
            self.assertEqual(result["stats"]["already_backed_up"], 1)
            self.assertEqual(result["stats"]["success"], 0)

    def test_reports_an_already_backed_up_file_separately_from_an_uncaptioned_one(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            run_backup_captions_job(root)
            write_media(root, "harbor.png")

            result = run_backup_captions_job(root)

            messages = {entry["name"]: entry["message"] for entry in result["results"]}
            self.assertEqual(messages["sunset.png"], "Already in the backup")
            self.assertEqual(messages["harbor.png"], "No sidecar to back up")
            self.assertEqual(result["stats"]["already_backed_up"], 1)
            self.assertEqual(result["stats"]["skipped"], 1)

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
            write_txt_caption(media, "A structured caption.")
            run_backup_captions_job(root)

            media.with_suffix(".txt").unlink()

            run_restore_captions_job(root)

            self.assertTrue(media.with_suffix(".txt").is_file())

    def test_a_restore_brings_back_no_findings(self) -> None:
        """Restoring a caption must not resurrect the verdict written against it."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            write_issue_sidecar(media, "The caption omits the mountains.")
            run_backup_captions_job(root)

            media.with_suffix(".txt").unlink()
            issue_file_path(media).unlink()

            result = run_restore_captions_job(root)

            self.assertTrue(media.with_suffix(".txt").is_file())
            self.assertFalse(issue_file_path(media).exists())
            self.assertEqual(load_issue_summary(media), ([], False))
            self.assertEqual(result["stats"]["success"], 1)

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
