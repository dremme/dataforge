"""Unit tests for unified caption loading."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from captions import build_caption_response, load_caption_summary
from testing_fixtures import TempMediaFolder, write_json_caption, write_media


class CaptionLoaderTests(unittest.TestCase):
    def test_summary_and_response_share_one_json_read(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_json_caption(
                media,
                {
                    "description": "Shared caption.",
                    "elements": [{"desc": "Sign"}],
                },
            )
            read_calls = {"count": 0}
            original = Path.read_text

            def counting_read_text(self, *args, **kwargs):
                if self.suffix == ".json":
                    read_calls["count"] += 1
                return original(self, *args, **kwargs)

            with patch.object(Path, "read_text", counting_read_text):
                summary = load_caption_summary(media)
                response = build_caption_response(media)

            self.assertEqual(summary[0], "Shared caption.")
            self.assertEqual(response["description"], "Shared caption.")
            self.assertEqual(read_calls["count"], 2)


if __name__ == "__main__":
    unittest.main()
