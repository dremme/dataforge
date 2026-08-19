"""Unit tests for folder fingerprint helpers."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from captions import save_issue_fixes
from duplicates import DuplicateFinding, save_duplicate_finding
from folder_fingerprint import compute_folder_fingerprint
from testing_fixtures import TempMediaFolder, write_media, write_txt_caption


class FolderFingerprintTests(unittest.TestCase):
    def test_fingerprint_is_stable_for_unchanged_folder(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            first = compute_folder_fingerprint(root)
            second = compute_folder_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertEqual(first, second)

    def test_fingerprint_changes_when_media_is_added(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            first = compute_folder_fingerprint(root)
            write_media(root, "beta.png")
            second = compute_folder_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertNotEqual(first, second)

    def test_fingerprint_changes_when_sidecar_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            first = compute_folder_fingerprint(root)
            write_txt_caption(media, "New caption.")
            second = compute_folder_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertNotEqual(first, second)

    def test_fingerprint_changes_when_a_finding_is_written(self) -> None:
        """Findings sit under the media's whole filename, which the signature must watch.

        A job that only writes findings changes nothing else in the folder, so missing
        them here would leave every open tab showing counts from before the run.
        """
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            first = compute_folder_fingerprint(root)

            save_issue_fixes(media, ["The caption omits the mountains."])
            second = compute_folder_fingerprint(root)

            save_duplicate_finding(
                media, DuplicateFinding(group="abc123", max_distance=0, threshold="exact")
            )
            third = compute_folder_fingerprint(root)

            self.assertNotEqual(first, second)
            self.assertNotEqual(second, third)

    def test_fingerprint_changes_when_subfolder_is_added(self) -> None:
        with TempMediaFolder() as root:
            first = compute_folder_fingerprint(root)
            (root / "Album").mkdir()
            second = compute_folder_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
