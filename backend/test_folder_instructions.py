from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from constants import CAPTION_RULES_FILENAME, SYSPROMPT_FILENAME
from folder_instructions import find_instruction_file
from sysprompt import load_sysprompt
from testing_fixtures import TempMediaFolder, write_sysprompt


class FindInstructionFileTests(unittest.TestCase):
    def test_a_parent_folder_file_applies_to_its_subfolders(self) -> None:
        with TempMediaFolder() as root:
            rules = root / CAPTION_RULES_FILENAME
            rules.write_text("repeated_phrases: 4\n", encoding="utf-8")
            nested = root / "portraits" / "outdoor"
            nested.mkdir(parents=True)

            self.assertEqual(find_instruction_file(nested, CAPTION_RULES_FILENAME), rules)

    def test_the_nearest_file_wins(self) -> None:
        with TempMediaFolder() as root:
            (root / CAPTION_RULES_FILENAME).write_text("repeated_phrases: 4\n", encoding="utf-8")
            child = root / "portraits"
            child.mkdir()
            nearest = child / CAPTION_RULES_FILENAME
            nearest.write_text("repeated_phrases: 3\n", encoding="utf-8")

            self.assertEqual(find_instruction_file(child, CAPTION_RULES_FILENAME), nearest)

    def test_a_folder_named_like_the_file_is_not_an_instruction_file(self) -> None:
        with TempMediaFolder() as root:
            (root / CAPTION_RULES_FILENAME).mkdir()

            self.assertIsNone(find_instruction_file(root, CAPTION_RULES_FILENAME))


class LoadSyspromptTests(unittest.TestCase):
    def test_a_folder_without_its_own_uses_the_parent_prompt(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "  Describe the scene.  ")
            child = root / "portraits"
            child.mkdir()

            self.assertEqual(load_sysprompt(child), "Describe the scene.")

    def test_the_folder_own_prompt_wins(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            child = root / "portraits"
            child.mkdir()
            write_sysprompt(child, "Describe the person.")

            self.assertEqual(load_sysprompt(child), "Describe the person.")

    def test_an_empty_nearest_file_means_no_prompt(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            child = root / "portraits"
            child.mkdir()
            (child / SYSPROMPT_FILENAME).write_text("  \n", encoding="utf-8")

            self.assertIsNone(load_sysprompt(child))

    def test_no_file_anywhere_means_no_prompt(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(load_sysprompt(root))


if __name__ == "__main__":
    unittest.main()
