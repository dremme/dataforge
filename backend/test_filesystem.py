"""Tests for filesystem helpers."""

from __future__ import annotations

import os
import unittest

from fastapi import HTTPException

from filesystem import (
    create_subfolder,
    folder_display_name,
    list_child_folders,
    looks_like_windows_path,
    normalize_folder_path,
    normalize_user_path,
    path_leaf_name,
    preference_folder_key,
    sanitize_folder_name,
)
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


class PathHandlingTests(unittest.TestCase):
    def test_looks_like_windows_path(self) -> None:
        self.assertTrue(looks_like_windows_path(r"C:\Photos"))
        self.assertTrue(looks_like_windows_path("C:/Photos"))
        self.assertTrue(looks_like_windows_path("c:"))
        self.assertFalse(looks_like_windows_path("/tmp/photos"))
        self.assertFalse(looks_like_windows_path("relative/folder"))

    def test_path_leaf_name_windows_string_on_any_os(self) -> None:
        self.assertEqual(path_leaf_name(r"C:\datasets\landscapes"), "landscapes")
        self.assertEqual(path_leaf_name("C:/datasets/landscapes"), "landscapes")
        self.assertEqual(path_leaf_name("/tmp/landscapes"), "landscapes")

    def test_normalize_user_path_resolves_existing_temp_folder(self) -> None:
        with TempMediaFolder() as root:
            resolved = normalize_user_path(str(root))
            self.assertEqual(resolved, root.resolve())
            self.assertEqual(normalize_folder_path(str(root)), resolved)

    def test_normalize_user_path_preserves_host_separators(self) -> None:
        with TempMediaFolder() as root:
            # Converting / to \\ used to 404 every browse call on Linux CI.
            as_posix = root.resolve().as_posix()
            self.assertEqual(normalize_user_path(as_posix), root.resolve())

    def test_preference_folder_key_is_stable(self) -> None:
        win_key = preference_folder_key(r"C:\Photos\A")
        self.assertEqual(preference_folder_key(win_key), win_key)
        self.assertEqual(preference_folder_key("c:"), "C:\\")
        self.assertEqual(preference_folder_key("C:/"), "C:\\")

        with TempMediaFolder() as root:
            host_key = preference_folder_key(str(root))
            self.assertEqual(preference_folder_key(host_key), host_key)
            self.assertEqual(host_key, str(root.resolve()))

    def test_folder_display_name(self) -> None:
        self.assertEqual(folder_display_name(r"C:\Photos\Album"), "Album")
        with TempMediaFolder() as root:
            child = root / "Album"
            child.mkdir()
            self.assertEqual(folder_display_name(child), "Album")

    @unittest.skipUnless(os.name == "nt", "Windows drive roots only")
    def test_windows_drive_root(self) -> None:
        resolved = normalize_user_path("c:/")
        self.assertEqual(str(resolved), "C:\\")


class ListChildFoldersTests(unittest.TestCase):
    def test_lists_directories_without_stats_fields(self) -> None:
        with TempMediaFolder() as root:
            (root / "Album").mkdir()
            (root / "skip.txt").write_text("file", encoding="utf-8")

            children = list_child_folders(root)

            self.assertEqual(len(children), 1)
            self.assertEqual(children[0]["name"], "Album")
            self.assertEqual(children[0]["path"], str((root / "Album").resolve()))
            self.assertEqual(set(children[0].keys()), {"name", "path"})


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
