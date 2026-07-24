"""Unit tests for browse fingerprint helpers."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from folder_fingerprint import folder_browse_fingerprint
from testing_fixtures import TempMediaFolder, write_media, write_txt_caption


class FolderBrowseFingerprintTests(unittest.TestCase):
    def test_fingerprint_is_stable_for_unchanged_folder(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            first = folder_browse_fingerprint(root)
            second = folder_browse_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertEqual(first, second)

    def test_fingerprint_changes_when_media_is_added(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "alpha.png")
            first = folder_browse_fingerprint(root)
            write_media(root, "beta.png")
            second = folder_browse_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertNotEqual(first, second)

    def test_fingerprint_changes_when_sidecar_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "alpha.png")
            first = folder_browse_fingerprint(root)
            write_txt_caption(media, "New caption.")
            second = folder_browse_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertNotEqual(first, second)

    def test_fingerprint_changes_when_subfolder_is_added(self) -> None:
        with TempMediaFolder() as root:
            first = folder_browse_fingerprint(root)
            (root / "Album").mkdir()
            second = folder_browse_fingerprint(root)

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
