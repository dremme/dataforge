"""Unit tests for the duplicate sidecar."""

from __future__ import annotations

import unittest

from testing_fixtures import isolate_test_database

isolate_test_database()

import shutil

from duplicates import (
    DuplicateFinding,
    delete_duplicate_file,
    duplicate_file_path,
    group_duplicate_findings,
    load_duplicate_finding,
    save_duplicate_finding,
    stale_duplicate_members,
)
from folder_scan import scan_folder
from testing_fixtures import TempMediaFolder, write_media

FINDING = DuplicateFinding(group="abc123", max_distance=0, threshold="exact")


def scan(root):
    scanned = scan_folder(root)
    assert scanned is not None
    return scanned


class SaveAndLoadTests(unittest.TestCase):
    def test_round_trips_a_finding(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")

            save_duplicate_finding(media, FINDING)

            self.assertEqual(load_duplicate_finding(media), FINDING)

    def test_saving_none_removes_the_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")
            save_duplicate_finding(media, FINDING)

            save_duplicate_finding(media, None)

            self.assertFalse(duplicate_file_path(media).exists())

    def test_saving_none_on_a_clean_file_is_a_no_op(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")

            save_duplicate_finding(media, None)

            self.assertFalse(duplicate_file_path(media).exists())

    def test_no_sidecar_reads_as_no_finding(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")

            self.assertIsNone(load_duplicate_finding(media))

    def test_a_sidecar_with_a_bom_still_reads(self) -> None:
        """Notepad adds one, and rejecting the file over three bytes loses the finding."""
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")
            duplicate_file_path(media).write_text(
                '{"group": "abc123", "max_distance": 0, "threshold": "exact"}',
                encoding="utf-8-sig",
            )

            self.assertEqual(load_duplicate_finding(media), FINDING)

    def test_a_malformed_sidecar_reads_as_no_finding(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")
            duplicate_file_path(media).write_text("{not json", encoding="utf-8")

            self.assertIsNone(load_duplicate_finding(media))

    def test_a_sidecar_without_a_group_reads_as_no_finding(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")
            duplicate_file_path(media).write_text('{"max_distance": 0}', encoding="utf-8")

            self.assertIsNone(load_duplicate_finding(media))

    def test_delete_removes_the_sidecar_and_tolerates_its_absence(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "one.png")
            save_duplicate_finding(media, FINDING)

            delete_duplicate_file(media)
            delete_duplicate_file(media)

            self.assertFalse(duplicate_file_path(media).exists())

    def test_exact_is_derived_from_the_distance(self) -> None:
        self.assertTrue(DuplicateFinding(group="a", max_distance=0, threshold="near").exact)
        self.assertFalse(DuplicateFinding(group="a", max_distance=3, threshold="exact").exact)


class GroupingTests(unittest.TestCase):
    def test_groups_files_sharing_an_id(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)

            groups = group_duplicate_findings(scan(root))

            self.assertEqual(list(groups), ["abc123"])
            self.assertEqual([path.name for path, _ in groups["abc123"]], ["one.png", "two.png"])

    def test_a_lone_member_is_not_a_group(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            save_duplicate_finding(first, FINDING)

            self.assertEqual(group_duplicate_findings(scan(root)), {})
            self.assertEqual([p.name for p in stale_duplicate_members(scan(root))], ["one.png"])

    def test_a_deleted_partner_leaves_the_group_stale(self) -> None:
        """No stored member list to go wrong: membership is whatever still carries the id."""
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)

            second.unlink()
            duplicate_file_path(second).unlink()

            self.assertEqual(group_duplicate_findings(scan(root)), {})
            self.assertEqual([p.name for p in stale_duplicate_members(scan(root))], ["one.png"])

    def test_a_renamed_file_stays_in_its_group(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)

            # A rename carries the sidecar across, which is all membership depends on.
            shutil.move(first, root / "renamed.png")
            shutil.move(duplicate_file_path(first), duplicate_file_path(root / "renamed.png"))

            groups = group_duplicate_findings(scan(root))

            self.assertEqual(
                [path.name for path, _ in groups["abc123"]],
                ["renamed.png", "two.png"],
            )

    def test_an_orphaned_sidecar_is_ignored(self) -> None:
        """Its media is gone, so it describes nothing and must not count as a member."""
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)
            second.unlink()

            self.assertEqual(group_duplicate_findings(scan(root)), {})

    def test_separate_groups_stay_separate(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            third = write_media(root, "three.png")
            fourth = write_media(root, "four.png")
            other = DuplicateFinding(group="def456", max_distance=4, threshold="near")
            save_duplicate_finding(first, FINDING)
            save_duplicate_finding(second, FINDING)
            save_duplicate_finding(third, other)
            save_duplicate_finding(fourth, other)

            groups = group_duplicate_findings(scan(root))

            self.assertEqual(sorted(groups), ["abc123", "def456"])
            self.assertEqual(len(groups["abc123"]), 2)
            self.assertEqual(len(groups["def456"]), 2)


if __name__ == "__main__":
    unittest.main()
