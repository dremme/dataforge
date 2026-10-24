from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from automation.backup_captions import (
    caption_backup_dir,
    has_caption_backup,
    list_backup_sidecars,
    preview_restore_captions,
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

    def test_refreshes_only_selected_backups(self) -> None:
        with TempMediaFolder() as root:
            chosen = write_media(root, "sunset.png")
            other = write_media(root, "harbor.png")
            write_txt_caption(chosen, "First caption.")
            write_txt_caption(other, "Original harbor.")
            run_backup_captions_job(root)

            write_txt_caption(chosen, "Second caption.")
            write_txt_caption(other, "Updated harbor.")
            result = run_backup_captions_job(root, selected_paths=[chosen])

            self.assertEqual(
                caption_backup_dir(root).joinpath("sunset.txt").read_text(encoding="utf-8"),
                "Second caption.",
            )
            self.assertEqual(
                caption_backup_dir(root).joinpath("harbor.txt").read_text(encoding="utf-8"),
                "Original harbor.",
            )
            self.assertEqual(result["stats"]["success"], 1)

    def test_backing_up_again_refreshes_the_stored_copy(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "First caption.")
            run_backup_captions_job(root)

            write_txt_caption(media, "Second caption.")
            result = run_backup_captions_job(root)

            self.assertEqual(
                caption_backup_dir(root).joinpath("sunset.txt").read_text(encoding="utf-8"),
                "Second caption.",
            )
            self.assertEqual(result["stats"]["success"], 1)

    def test_refreshes_caption_backup_without_copying_leftover_json(self) -> None:
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
                "Second caption.",
            )
            self.assertFalse(backup_dir.joinpath("sunset.json").exists())
            self.assertEqual(result["stats"]["success"], 1)

    def test_reports_refreshed_captions_separately_from_uncaptioned_files(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "A plain caption.")
            run_backup_captions_job(root)
            write_media(root, "harbor.png")

            result = run_backup_captions_job(root)

            statuses = {entry["name"]: entry["status"] for entry in result["results"]}
            messages = {entry["name"]: entry.get("message") for entry in result["results"]}
            self.assertEqual(statuses["sunset.png"], "success")
            self.assertEqual(messages["harbor.png"], "No sidecar to back up")
            self.assertEqual(result["stats"]["success"], 1)
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
        """Python 3.12's ``iterdir`` is a generator, so it raises on iteration."""

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
            self.assertEqual(load_issue_summary(media), ([], [], False))
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


class RestoreCaptionsPreviewTests(unittest.TestCase):
    def test_sorts_each_backup_by_what_a_restore_would_do(self) -> None:
        with TempMediaFolder() as root:
            changed = write_media(root, "changed.png")
            same = write_media(root, "same.png")
            missing = write_media(root, "missing.png")
            orphan = write_media(root, "orphan.png")
            for media in (changed, same, missing, orphan):
                write_txt_caption(media, f"Original {media.stem}.")
            run_backup_captions_job(root)

            write_txt_caption(changed, "Edited changed.")
            missing.with_suffix(".txt").unlink()
            orphan.unlink()
            orphan.with_suffix(".txt").unlink()

            preview = preview_restore_captions(root)

            self.assertEqual(
                {key: preview[key] for key in ("total", "changed", "missing", "unchanged")},
                {"total": 4, "changed": 1, "missing": 1, "unchanged": 1},
            )
            self.assertEqual(preview["orphaned"], 1)
            compared = ("name", "path", "backup", "current", "error")
            self.assertEqual(
                [{key: sample[key] for key in compared} for sample in preview["samples"]],
                [
                    {
                        "name": "changed.png",
                        "path": str(changed),
                        "backup": "Original changed.",
                        "current": "Edited changed.",
                        "error": None,
                    },
                    {
                        "name": "missing.png",
                        "path": str(missing),
                        "backup": "Original missing.",
                        "current": None,
                        "error": None,
                    },
                ],
            )

    def test_versions_each_sample_by_its_media_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Original sunset.")
            run_backup_captions_job(root)
            write_txt_caption(media, "Edited sunset.")
            before = preview_restore_captions(root)["samples"][0]["version"]

            media.write_bytes(media.read_bytes() + b"\0")
            after = preview_restore_captions(root)["samples"][0]["version"]

            self.assertIsNotNone(before)
            self.assertNotEqual(before, after)

    def test_ignores_a_byte_order_mark_and_surrounding_whitespace(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            media.with_suffix(".txt").write_bytes(b"\xef\xbb\xbfA dog\r\nin a field\r\n")
            run_backup_captions_job(root)
            media.with_suffix(".txt").write_bytes(b"A dog\r\nin a field")

            preview = preview_restore_captions(root)

            self.assertEqual(preview["unchanged"], 1)
            self.assertEqual(preview["samples"], [])

    def test_reports_an_unreadable_caption_as_a_change(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Original sunset.")
            run_backup_captions_job(root)
            media.with_suffix(".txt").write_bytes(b"\xff\xfe not utf-8")

            preview = preview_restore_captions(root)

            self.assertEqual(preview["changed"], 1)
            [sample] = preview["samples"]
            self.assertIsNone(sample["current"])
            self.assertEqual(sample["error"], "Could not read the current caption")

    def test_honours_a_media_selection(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "sunset.png")
            second = write_media(root, "harbor.png")
            write_txt_caption(first, "Original sunset.")
            write_txt_caption(second, "Original harbor.")
            run_backup_captions_job(root)
            write_txt_caption(first, "Edited sunset.")
            write_txt_caption(second, "Edited harbor.")

            preview = preview_restore_captions(root, selected_paths=[first])

            self.assertEqual(preview["total"], 1)
            self.assertEqual([sample["name"] for sample in preview["samples"]], ["sunset.png"])

    def test_lists_every_differing_caption_by_name(self) -> None:
        with TempMediaFolder() as root:
            media_files = [write_media(root, f"photo{index}.png") for index in range(4)]
            for media in media_files:
                write_txt_caption(media, "Original.")
            run_backup_captions_job(root)
            for media in media_files:
                write_txt_caption(media, "Edited.")

            preview = preview_restore_captions(root)

            self.assertEqual(preview["changed"], 4)
            self.assertEqual(
                [sample["name"] for sample in preview["samples"]],
                ["photo0.png", "photo1.png", "photo2.png", "photo3.png"],
            )

    def test_requires_an_existing_backup(self) -> None:
        with TempMediaFolder() as root:
            write_txt_caption(write_media(root, "sunset.png"), "A plain caption.")

            with self.assertRaisesRegex(ValueError, "No caption backup"):
                preview_restore_captions(root)


if __name__ == "__main__":
    unittest.main()
