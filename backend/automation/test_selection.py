from __future__ import annotations

import unittest

from automation.selection import filter_media_list, resolve_selected_media
from testing_fixtures import TempMediaFolder, write_media


class SelectionHelpersTests(unittest.TestCase):
    def test_resolve_selected_media_returns_none_for_empty_paths(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(resolve_selected_media(root, None))
            self.assertIsNone(resolve_selected_media(root, []))

    def test_resolve_selected_media_resolves_paths_inside_folder(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            resolved = resolve_selected_media(root, [str(media)])
            self.assertIsNotNone(resolved)
            assert resolved is not None
            self.assertEqual(resolved[0].resolve(), media.resolve())

    def test_resolve_selected_media_rejects_paths_outside_folder(self) -> None:
        with TempMediaFolder() as root:
            outside = write_media(root.parent, "outside.png")
            with self.assertRaisesRegex(ValueError, "outside the selected folder"):
                resolve_selected_media(root, [str(outside)])

    def test_filter_media_list_returns_all_when_no_selection(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            media_files = [first, second]
            self.assertEqual(filter_media_list(media_files, None), media_files)

    def test_filter_media_list_limits_to_selected_paths(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            filtered = filter_media_list([first, second], [first])
            self.assertEqual(filtered, [first])

    def test_filter_media_list_raises_when_selection_matches_nothing(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")
            with self.assertRaisesRegex(ValueError, "No matching media files"):
                filter_media_list([first], [second])


if __name__ == "__main__":
    unittest.main()
