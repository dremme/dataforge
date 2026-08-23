"""A leftover ``.json`` next to media is not a caption; only ``.txt`` is."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path

from captions import (
    load_caption_summary,
    load_reference_caption,
    media_has_caption_text,
    resolve_caption_file,
    save_caption,
)
from testing_fixtures import (
    TempMediaFolder,
    write_media,
    write_txt_caption,
)


def _write_leftover_json(
    media: Path, payload: str = '{"description": "From the JSON sidecar."}\n'
) -> Path:
    path = media.with_suffix(".json")
    path.write_text(payload, encoding="utf-8")
    return path


class CaptionTxtOnlyTests(unittest.TestCase):
    def test_resolve_finds_txt_and_ignores_json(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")
            _write_leftover_json(media)

            caption_path = resolve_caption_file(media)

            self.assertEqual(caption_path, media.with_suffix(".txt"))

    def test_resolve_ignores_json_when_txt_is_absent(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            _write_leftover_json(media)

            self.assertIsNone(resolve_caption_file(media))

    def test_summary_reports_the_txt_caption(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "From the text sidecar.")
            _write_leftover_json(media)

            description, status = load_caption_summary(media)

            self.assertEqual(description, "From the text sidecar.")
            self.assertEqual(status, "text")

    def test_summary_treats_json_only_media_as_uncaptioned(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            _write_leftover_json(media)

            description, status = load_caption_summary(media)

            self.assertIsNone(description)
            self.assertEqual(status, "none")

    def test_reference_caption_reads_the_txt_sidecar(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "  From the text sidecar.  ")
            _write_leftover_json(media)

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

            leftover = write_media(root, "elements.png")
            _write_leftover_json(leftover, '{"elements": [{"size": [1, 2]}]}\n')
            self.assertEqual(load_reference_caption(leftover), (None, "no_caption"))

    def test_saving_writes_txt_and_leaves_leftover_json_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            leftover = _write_leftover_json(media)
            before = leftover.read_text(encoding="utf-8")

            response = save_caption(media, "Rewritten caption.")

            self.assertEqual(response["caption_file"], str(media.with_suffix(".txt")))
            self.assertEqual(
                media.with_suffix(".txt").read_text(encoding="utf-8"),
                "Rewritten caption.\n",
            )
            self.assertEqual(leftover.read_text(encoding="utf-8"), before)
            text, _status = load_reference_caption(media)
            self.assertEqual(text, "Rewritten caption.")

    def test_folder_summary_does_not_count_leftover_json(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            _write_leftover_json(media)

            self.assertFalse(media_has_caption_text(media))


if __name__ == "__main__":
    unittest.main()
