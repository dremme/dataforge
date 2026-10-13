from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import system_fonts
from system_fonts import clear_font_index, find_face, installed_families

#: What each fake file would report, keyed by name; a ``.ttc`` lists one entry per face.
FACES = {
    "sans.ttf": [("Sans", "Regular")],
    "sans-bold.ttf": [("Sans", "Bold")],
    "sans-light.ttf": [("Sans", "Light")],
    "sans-italic.otf": [("Sans", "Italic")],
    "sans~copy.ttf": [("sans", "regular")],
    "serif.ttc": [("Serif", "Bold"), ("Serif", "Black")],
    "hidden.ttf": [(".SystemOnly", "Regular")],
}


class FontIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        for name in [*FACES, "readme.txt"]:
            (self.root / name).write_bytes(b"")
        patches = [
            patch.object(system_fonts, "font_directories", return_value=[self.root]),
            patch.object(
                system_fonts, "read_faces", side_effect=lambda path: FACES.get(path.name, [])
            ),
        ]
        for active in patches:
            active.start()
            self.addCleanup(active.stop)
        clear_font_index()
        self.addCleanup(clear_font_index)

    def test_families_list_their_styles_with_the_basic_four_first(self) -> None:
        self.assertEqual(
            installed_families(),
            [("Sans", ["Regular", "Italic", "Bold", "Light"]), ("Serif", ["Bold", "Black"])],
        )

    def test_a_face_is_found_by_family_and_style_whatever_their_case(self) -> None:
        face = find_face("serif", "BLACK")

        self.assertIsNotNone(face)
        assert face is not None
        self.assertEqual((face.path.name, face.index), ("serif.ttc", 1))

    def test_a_missing_style_falls_back_to_regular_then_the_first_style(self) -> None:
        sans = find_face("Sans", "Condensed")
        serif = find_face("Serif", "Regular")

        self.assertEqual(sans.path.name if sans else None, "sans.ttf")
        self.assertEqual(serif.style if serif else None, "Bold")

    def test_an_unknown_family_is_not_found(self) -> None:
        self.assertIsNone(find_face("Nowhere", "Regular"))

    def test_a_font_installed_later_is_picked_up(self) -> None:
        self.assertIsNone(find_face("Mono", "Regular"))
        FACES["mono.ttf"] = [("Mono", "Regular")]
        self.addCleanup(FACES.pop, "mono.ttf")
        (self.root / "mono.ttf").write_bytes(b"")
        stamp = self.root.stat().st_mtime_ns + 1_000_000_000
        os.utime(self.root, ns=(stamp, stamp))

        self.assertIsNotNone(find_face("Mono", "Regular"))


if __name__ == "__main__":
    unittest.main()
