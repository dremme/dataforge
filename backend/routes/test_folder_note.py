from __future__ import annotations

import unittest
from pathlib import Path
from urllib.parse import quote

from constants import NOTE_FILENAME
from routes._test_client import client
from testing_fixtures import TempMediaFolder


def _save(folder: Path, text: str):
    return client.put(f"/api/folder-note?path={quote(str(folder))}", json={"text": text})


def _listing(folder: Path) -> dict:
    response = client.get(f"/api/folders/contents?path={quote(str(folder))}")
    assert response.status_code == 200, response.text
    return response.json()


def _changes(folder: Path, since: str) -> dict:
    response = client.get(f"/api/folders/changes?path={quote(str(folder))}&since={quote(since)}")
    assert response.status_code == 200, response.text
    return response.json()


class FolderNoteEndpointTests(unittest.TestCase):
    def test_saved_note_appears_in_the_listing(self) -> None:
        with TempMediaFolder() as root:
            self.assertEqual(_listing(root)["note"], "")

            response = _save(root, "  Reshoot the dusk set.\n")

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {"text": "Reshoot the dusk set."})
            self.assertEqual(_listing(root)["note"], "Reshoot the dusk set.")

    def test_blank_note_deletes_the_file(self) -> None:
        with TempMediaFolder() as root:
            _save(root, "Temporary")

            response = _save(root, "   ")

            self.assertEqual(response.json(), {"text": ""})
            self.assertFalse((root / NOTE_FILENAME).exists())
            self.assertEqual(_listing(root)["note"], "")

    def test_parent_note_does_not_apply_to_a_subfolder(self) -> None:
        with TempMediaFolder() as root:
            child = root / "portraits"
            child.mkdir()
            _save(root, "Parent only")

            self.assertEqual(_listing(child)["note"], "")

    def test_editing_the_note_forces_a_full_relisting(self) -> None:
        with TempMediaFolder() as root:
            fingerprint = _listing(root)["fingerprint"]

            _save(root, "New note")

            self.assertTrue(_changes(root, fingerprint)["full"])

    def test_note_file_is_not_listed_as_media(self) -> None:
        with TempMediaFolder() as root:
            _save(root, "Hidden")

            names = [item["name"] for item in _listing(root)["items"]]
            self.assertNotIn(NOTE_FILENAME, names)


if __name__ == "__main__":
    unittest.main()
