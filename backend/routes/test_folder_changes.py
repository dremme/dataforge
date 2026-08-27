from __future__ import annotations

import unittest
from urllib.parse import quote

from constants import STAGING_DIR_NAME
from folder_fingerprint import clear_remembered_signatures_for_tests
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    write_media,
    write_txt_caption,
)


class FolderChangesTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_remembered_signatures_for_tests()

    def _listing(self, root) -> dict:
        return client.get(f"/api/folders/contents?path={quote(str(root))}").json()

    def _changes(self, root, since: str) -> dict:
        return client.get(
            f"/api/folders/changes?path={quote(str(root))}&since={quote(since)}"
        ).json()

    def test_an_unchanged_folder_reports_nothing(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            listed = self._listing(root)

            changes = self._changes(root, listed["fingerprint"])

            self.assertFalse(changes["full"])
            self.assertEqual(changes["changed"], [])
            self.assertEqual(changes["removed"], [])
            self.assertEqual(changes["fingerprint"], listed["fingerprint"])

    def test_a_rewritten_caption_returns_only_that_item(self) -> None:
        """The whole point: one caption changing must not cost a whole folder."""
        with TempMediaFolder() as root:
            edited = write_media(root, "edited.png")
            write_media(root, "untouched.png")
            write_media(root, "also-untouched.png")
            listed = self._listing(root)

            write_txt_caption(edited, "A newly written caption for this one file.")

            changes = self._changes(root, listed["fingerprint"])

            self.assertFalse(changes["full"])
            self.assertEqual([item["name"] for item in changes["changed"]], ["edited.png"])
            self.assertEqual(
                changes["changed"][0]["description"],
                "A newly written caption for this one file.",
            )
            self.assertEqual(changes["removed"], [])

    def test_a_new_file_arrives_in_changed(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "first.png")
            listed = self._listing(root)

            write_media(root, "second.png")

            changes = self._changes(root, listed["fingerprint"])

            self.assertFalse(changes["full"])
            self.assertEqual([item["name"] for item in changes["changed"]], ["second.png"])

    def test_a_deleted_file_is_reported_by_path(self) -> None:
        with TempMediaFolder() as root:
            doomed = write_media(root, "doomed.png")
            write_media(root, "survivor.png")
            listed = self._listing(root)

            doomed.unlink()

            changes = self._changes(root, listed["fingerprint"])

            self.assertFalse(changes["full"])
            self.assertEqual(changes["changed"], [])
            self.assertEqual(changes["removed"], [str(root.resolve() / "doomed.png")])

    def test_an_unknown_baseline_asks_for_a_full_reload(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            self._listing(root)

            changes = self._changes(root, "not-a-fingerprint-we-ever-issued")

            self.assertTrue(changes["full"])
            self.assertTrue(changes["fingerprint"])

    def test_no_baseline_at_all_asks_for_a_full_reload(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            changes = client.get(f"/api/folders/changes?path={quote(str(root))}").json()

            self.assertTrue(changes["full"])

    def test_a_new_candidate_returns_only_that_item(self) -> None:
        """Staging is a child directory, so writing inside it must not full-reload."""
        with TempMediaFolder() as root:
            write_media(root, "upscaled.png")
            write_media(root, "untouched.png")
            (root / STAGING_DIR_NAME).mkdir()
            listed = self._listing(root)

            write_media(root / STAGING_DIR_NAME, "upscaled.png")

            changes = self._changes(root, listed["fingerprint"])

            self.assertFalse(changes["full"])
            self.assertEqual([item["name"] for item in changes["changed"]], ["upscaled.png"])
            self.assertTrue(changes["changed"][0]["has_candidate"])
            self.assertEqual(changes["removed"], [])

    def test_a_new_subfolder_asks_for_a_full_reload(self) -> None:
        """Subfolders are not part of a delta, so the shell changing sends the client back."""
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            listed = self._listing(root)

            (root / "album").mkdir()

            changes = self._changes(root, listed["fingerprint"])

            self.assertTrue(changes["full"])

    def test_the_returned_fingerprint_becomes_the_next_baseline(self) -> None:
        with TempMediaFolder() as root:
            edited = write_media(root, "photo.png")
            listed = self._listing(root)

            write_txt_caption(edited, "A newly written caption for this one file.")
            first = self._changes(root, listed["fingerprint"])

            second = self._changes(root, first["fingerprint"])

            self.assertFalse(second["full"])
            self.assertEqual(second["changed"], [])

    def test_a_missing_folder_is_a_404_like_every_other_folder_route(self) -> None:
        response = client.get("/api/folders/changes?path=" + quote(r"C:\datasets\does-not-exist"))
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
