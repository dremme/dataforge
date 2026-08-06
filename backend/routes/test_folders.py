"""Tests for /api/folders/*."""

from __future__ import annotations

import os
import unittest
from unittest import mock
from urllib.parse import quote

from routes._test_client import client
from testing_fixtures import TempMediaFolder


class FolderChildrenEndpointTests(unittest.TestCase):
    def test_lists_immediate_child_folders_only(self) -> None:
        with TempMediaFolder() as root:
            (root / "Album").mkdir()
            (root / "Vacation").mkdir()
            (root / "notes.txt").write_text("skip files", encoding="utf-8")

            response = client.get(f"/api/folders/children?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["folder"], str(root.resolve()))
            names = {entry["name"] for entry in body["children"]}
            paths = {entry["path"] for entry in body["children"]}
            self.assertEqual(names, {"Album", "Vacation"})
            self.assertIn(str((root / "Album").resolve()), paths)
            for entry in body["children"]:
                self.assertEqual(set(entry.keys()), {"name", "path"})

    def test_returns_404_for_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"
            response = client.get(f"/api/folders/children?path={quote(str(missing))}")
            self.assertEqual(response.status_code, 404)

    def test_does_not_update_last_opened_folder(self) -> None:
        from constants import LAST_FOLDER_KEY
        from db import get_preference, set_preference

        with TempMediaFolder() as root:
            child = root / "Album"
            child.mkdir()
            set_preference(LAST_FOLDER_KEY, str(root.resolve()))

            response = client.get(f"/api/folders/children?path={quote(str(child))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(get_preference(LAST_FOLDER_KEY), str(root.resolve()))


class FolderOpenEndpointTests(unittest.TestCase):
    def test_opens_existing_folder(self) -> None:
        with TempMediaFolder() as root:
            with mock.patch("routes.folders.open_folder_in_file_manager") as open_folder:
                response = client.post(f"/api/folders/open?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["path"], str(root.resolve()))
            open_folder.assert_called_once()

    def test_returns_404_for_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            response = client.post(f"/api/folders/open?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_returns_500_when_file_manager_fails(self) -> None:
        from filesystem import FolderExplorerError

        with TempMediaFolder() as root:
            with mock.patch(
                "routes.folders.open_folder_in_file_manager",
                side_effect=FolderExplorerError("File manager is not available on this system"),
            ):
                response = client.post(f"/api/folders/open?path={quote(str(root))}")

            self.assertEqual(response.status_code, 500)
            self.assertEqual(
                response.json()["detail"],
                "File manager is not available on this system",
            )


class FolderFavoritesEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        from db import get_connection
        from folder_favorites import FOLDER_FAVORITES_KEY

        with get_connection() as conn:
            conn.execute("DELETE FROM preferences WHERE key = ?", (FOLDER_FAVORITES_KEY,))
            conn.commit()

    def test_defaults_to_home_folder(self) -> None:
        response = client.get("/api/folders/favorites")

        self.assertEqual(response.status_code, 200)
        favorites = response.json()["favorites"]
        self.assertEqual(len(favorites), 1)
        self.assertEqual(favorites[0]["name"], "Home")

    def test_add_and_remove_favorite(self) -> None:
        with TempMediaFolder() as root:
            add_response = client.post(f"/api/folders/favorites?path={quote(str(root))}")

            self.assertEqual(add_response.status_code, 200)
            favorites = add_response.json()["favorites"]
            paths = {entry["path"] for entry in favorites}
            self.assertIn(str(root.resolve()), paths)

            remove_response = client.delete(f"/api/folders/favorites?path={quote(str(root))}")

            self.assertEqual(remove_response.status_code, 200)
            remaining = {entry["path"] for entry in remove_response.json()["favorites"]}
            self.assertNotIn(str(root.resolve()), remaining)

    def test_add_favorite_rejects_missing_folder(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            response = client.post(f"/api/folders/favorites?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    @unittest.skipUnless(os.name == "nt", "Windows drive roots only")
    def test_add_drive_root_favorite(self) -> None:
        from pathlib import Path

        if not Path("C:\\").exists():
            self.skipTest("C: drive not available")

        response = client.post("/api/folders/favorites?path=" + quote("C:\\"))

        self.assertEqual(response.status_code, 200)
        favorites = response.json()["favorites"]
        paths = {entry["path"] for entry in favorites}
        self.assertIn("C:\\", paths)


class FolderCreateEndpointTests(unittest.TestCase):
    def test_creates_subfolder_in_parent(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                f"/api/folders/create?path={quote(str(root))}&name={quote('New Album')}"
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            created_path = root / "New Album"
            self.assertEqual(payload["name"], "New Album")
            self.assertEqual(payload["path"], str(created_path.resolve()))
            self.assertTrue(created_path.is_dir())
            self.assertEqual(payload["file_count"], 0)
            self.assertEqual(payload["captioned_count"], 0)

    def test_returns_404_for_missing_parent(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            response = client.post(
                f"/api/folders/create?path={quote(str(missing))}&name={quote('Album')}"
            )

            self.assertEqual(response.status_code, 404)

    def test_rejects_invalid_folder_name(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                f"/api/folders/create?path={quote(str(root))}&name={quote('bad/name')}"
            )

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Invalid folder name")

    def test_returns_409_when_folder_exists(self) -> None:
        with TempMediaFolder() as root:
            existing = root / "Album"
            existing.mkdir()

            response = client.post(
                f"/api/folders/create?path={quote(str(root))}&name={quote('Album')}"
            )

            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["detail"], "Folder already exists")


if __name__ == "__main__":
    unittest.main()
