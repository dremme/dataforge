from __future__ import annotations

import unittest
from pathlib import Path
from urllib.parse import quote

from caption_rules import STARTER_CAPTION_RULES
from constants import CAPTION_RULES_FILENAME, SYSPROMPT_FILENAME
from routes._test_client import client
from testing_fixtures import TempMediaFolder

#: The PUT route, and a valid body, for each instruction file.
FILES = {
    SYSPROMPT_FILENAME: ("sysprompt", "Describe the scene."),
    CAPTION_RULES_FILENAME: ("caption-rules", "repeated_phrases: 4"),
}
KEYS = {SYSPROMPT_FILENAME: "sysprompt", CAPTION_RULES_FILENAME: "caption_rules"}


def _instructions(folder: Path) -> dict:
    response = client.get(f"/api/folder-instructions?path={quote(str(folder))}")
    assert response.status_code == 200, response.text
    return response.json()


def _save(folder: Path, filename: str, text: str):
    route, _ = FILES[filename]
    return client.put(f"/api/{route}?path={quote(str(folder))}", json={"text": text})


def _nested(root: Path) -> Path:
    child = root / "portraits"
    child.mkdir()
    return child


class FolderInstructionsEndpointTests(unittest.TestCase):
    """Each file is edited in the folder's own copy only; a parent's is reported, never written."""

    def test_reports_both_files_as_missing_with_the_rules_template(self) -> None:
        empty = {
            "text": "",
            "has_file": False,
            "parent_folder": None,
            "parent_relative_path": None,
            "parent_text": "",
        }
        with TempMediaFolder() as root:
            self.assertEqual(
                _instructions(root),
                {
                    "sysprompt": empty,
                    "caption_rules": empty,
                    "caption_rules_template": STARTER_CAPTION_RULES,
                },
            )

    def test_reports_a_parent_file_apart_from_the_folder_own(self) -> None:
        for filename, key in KEYS.items():
            with self.subTest(filename=filename), TempMediaFolder() as root:
                (root / filename).write_text("From the parent.\n", encoding="utf-8")
                child = _nested(root)

                reported = _instructions(child)[key]

                self.assertEqual(reported["text"], "")
                self.assertFalse(reported["has_file"])
                self.assertEqual(reported["parent_folder"], str(root))
                self.assertEqual(reported["parent_relative_path"], str(Path("..") / filename))
                self.assertEqual(reported["parent_text"], "From the parent.\n")

    def test_names_a_grandparent_file_relative_to_the_folder(self) -> None:
        with TempMediaFolder() as root:
            (root / SYSPROMPT_FILENAME).write_text("From above.\n", encoding="utf-8")
            grandchild = _nested(root) / "outdoor"
            grandchild.mkdir()

            self.assertEqual(
                _instructions(grandchild)["sysprompt"]["parent_relative_path"],
                str(Path("..") / ".." / SYSPROMPT_FILENAME),
            )

    def test_reports_the_parent_file_the_folder_own_overrides(self) -> None:
        for filename, key in KEYS.items():
            with self.subTest(filename=filename), TempMediaFolder() as root:
                (root / filename).write_text("From the parent.\n", encoding="utf-8")
                child = _nested(root)
                (child / filename).write_text("Its own.\n", encoding="utf-8")

                reported = _instructions(child)[key]

                self.assertEqual(reported["text"], "Its own.\n")
                self.assertTrue(reported["has_file"])
                self.assertEqual(reported["parent_folder"], str(root))

    def test_saving_creates_the_folder_own_file(self) -> None:
        for filename, (_, text) in FILES.items():
            with self.subTest(filename=filename), TempMediaFolder() as root:
                response = _save(root, filename, text)

                self.assertEqual(response.status_code, 200)
                self.assertEqual((root / filename).read_text(encoding="utf-8"), f"{text}\n")
                self.assertTrue(response.json()["has_file"])

    def test_saving_in_a_subfolder_never_touches_the_parent_file(self) -> None:
        for filename, (_, text) in FILES.items():
            with self.subTest(filename=filename), TempMediaFolder() as root:
                parent_file = root / filename
                parent_file.write_text("From the parent.\n", encoding="utf-8")
                child = _nested(root)

                response = _save(child, filename, text)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(parent_file.read_text(encoding="utf-8"), "From the parent.\n")
                self.assertEqual((child / filename).read_text(encoding="utf-8"), f"{text}\n")
                self.assertEqual(response.json()["parent_folder"], str(root))

    def test_saving_blank_text_removes_only_the_folder_own_file(self) -> None:
        for filename in FILES:
            with self.subTest(filename=filename), TempMediaFolder() as root:
                parent_file = root / filename
                parent_file.write_text("From the parent.\n", encoding="utf-8")
                child = _nested(root)
                own = child / filename
                own.write_text("Its own.\n", encoding="utf-8")

                response = _save(child, filename, "  \n\t")

                self.assertEqual(response.status_code, 200)
                self.assertFalse(own.exists())
                self.assertTrue(parent_file.is_file())
                self.assertFalse(response.json()["has_file"])

    def test_saving_blank_text_without_a_file_creates_nothing(self) -> None:
        for filename in FILES:
            with self.subTest(filename=filename), TempMediaFolder() as root:
                response = _save(root, filename, "")

                self.assertEqual(response.status_code, 200)
                self.assertFalse((root / filename).exists())

    def test_invalid_rules_are_refused_and_not_written(self) -> None:
        with TempMediaFolder() as root:
            response = _save(root, CAPTION_RULES_FILENAME, "colour: blue\n")

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "colour: unknown setting")
            self.assertFalse((root / CAPTION_RULES_FILENAME).exists())

    def test_a_missing_folder_is_not_found(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "does-not-exist"

            self.assertEqual(
                client.get(f"/api/folder-instructions?path={quote(str(missing))}").status_code,
                404,
            )
            for filename, (_, text) in FILES.items():
                with self.subTest(filename=filename):
                    self.assertEqual(_save(missing, filename, text).status_code, 404)


if __name__ == "__main__":
    unittest.main()
