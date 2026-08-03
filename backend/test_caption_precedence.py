"""A .json caption sidecar must win over a .txt one everywhere in the app."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from captions import (
    load_caption_summary,
    load_reference_caption,
    media_has_caption_text,
    resolve_caption_file,
    save_caption,
)
from testing_fixtures import (
    TempMediaFolder,
    write_json_caption,
    write_media,
    write_txt_caption,
)


class CaptionPrecedenceTests(unittest.TestCase):
    def test_resolve_prefers_json_over_txt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")
            write_json_caption(media, {"description": "From the JSON sidecar."})

            caption_path, caption_type = resolve_caption_file(media)

            self.assertEqual(caption_type, "json")
            self.assertEqual(caption_path, media.with_suffix(".json"))

    def test_resolve_falls_back_to_txt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")

            caption_path, caption_type = resolve_caption_file(media)

            self.assertEqual(caption_type, "txt")
            self.assertEqual(caption_path, media.with_suffix(".txt"))

    def test_summary_reports_the_json_caption(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")
            write_json_caption(media, {"description": "From the JSON sidecar."})

            description, status, caption_type = load_caption_summary(media)

            self.assertEqual(description, "From the JSON sidecar.")
            self.assertEqual(status, "text")
            self.assertEqual(caption_type, "json")

    def test_reference_caption_reads_the_json_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")
            write_json_caption(media, {"description": "From the JSON sidecar."})

            text, status = load_reference_caption(media)

            self.assertEqual(status, "ok")
            self.assertEqual(text, "From the JSON sidecar.")

    def test_reference_caption_reads_the_txt_sidecar_when_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "  From the text sidecar.  ")

            text, status = load_reference_caption(media)

            self.assertEqual(status, "ok")
            self.assertEqual(text, "From the text sidecar.")

    def test_reference_caption_reports_missing_and_empty_captions(self) -> None:
        with TempMediaFolder() as root:
            bare = write_media(root, "bare.png")
            self.assertEqual(load_reference_caption(bare), (None, "no_caption"))

            blank = write_media(root, "blank.png")
            write_txt_caption(blank, "   ")
            self.assertEqual(load_reference_caption(blank), (None, "no_caption"))

            no_description = write_media(root, "elements.png")
            write_json_caption(no_description, {"elements": [{"size": [1, 2]}]})
            self.assertEqual(load_reference_caption(no_description), (None, "no_caption"))

    def test_saving_updates_the_json_sidecar_and_leaves_txt_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")
            write_json_caption(media, {"description": "From the JSON sidecar."})

            response = save_caption(media, "Rewritten caption.")

            self.assertEqual(response["caption_file_type"], "json")
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8"),
                "From the text sidecar.",
            )
            text, _status = load_reference_caption(media)
            self.assertEqual(text, "Rewritten caption.")

    def test_folder_summary_counts_json_captions(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "   ")
            write_json_caption(media, {"description": "From the JSON sidecar."})

            self.assertTrue(media_has_caption_text(media))

    def test_blank_json_caption_beats_a_filled_txt_caption(self) -> None:
        """The JSON sidecar wins even when it is the emptier of the two."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")
            write_json_caption(media, {"description": ""})

            self.assertFalse(media_has_caption_text(media))
            self.assertEqual(load_reference_caption(media), (None, "no_caption"))


if __name__ == "__main__":
    unittest.main()
