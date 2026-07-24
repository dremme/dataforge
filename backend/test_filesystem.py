"""Tests for filesystem helpers."""

from __future__ import annotations

import unittest

from fastapi import HTTPException

from filesystem import create_subfolder, sanitize_folder_name
from testing_fixtures import TempMediaFolder


class SanitizeFolderNameTests(unittest.TestCase):
    def test_accepts_simple_name(self) -> None:
        self.assertEqual(sanitize_folder_name("Landscapes"), "Landscapes")

    def test_rejects_path_separators(self) -> None:
        self.assertIsNone(sanitize_folder_name("bad/name"))
        self.assertIsNone(sanitize_folder_name("bad\\name"))

    def test_rejects_reserved_windows_names(self) -> None:
        self.assertIsNone(sanitize_folder_name("CON"))
        self.assertIsNone(sanitize_folder_name("lpt1"))

    def test_rejects_trailing_dot_or_space(self) -> None:
        self.assertIsNone(sanitize_folder_name("Album."))
        self.assertIsNone(sanitize_folder_name("Album "))


class CreateSubfolderTests(unittest.TestCase):
    def test_creates_folder_on_disk(self) -> None:
        with TempMediaFolder() as root:
            created = create_subfolder(root, "New Album")

            self.assertEqual(created["name"], "New Album")
            self.assertEqual(created["path"], str((root / "New Album").resolve()))
            self.assertTrue((root / "New Album").is_dir())

    def test_raises_for_existing_folder(self) -> None:
        with TempMediaFolder() as root:
            (root / "Album").mkdir()

            with self.assertRaises(HTTPException) as ctx:
                create_subfolder(root, "Album")

            self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
