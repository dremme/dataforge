from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from captions import build_caption_response, load_caption_summary
from testing_fixtures import TempMediaFolder, write_media, write_txt_caption


class CaptionLoaderTests(unittest.TestCase):
    def test_summary_and_response_share_one_txt_read(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            write_txt_caption(media, "Shared caption.")
            read_calls = {"count": 0}
            original = Path.read_text

            def counting_read_text(self, *args, **kwargs):
                if self.suffix == ".txt":
                    read_calls["count"] += 1
                return original(self, *args, **kwargs)

            with patch.object(Path, "read_text", counting_read_text):
                summary = load_caption_summary(media)
                response = build_caption_response(media)

            self.assertEqual(summary[0], "Shared caption.")
            self.assertEqual(response["description"], "Shared caption.")
            self.assertEqual(read_calls["count"], 2)


class UnreadableSidecarTests(unittest.TestCase):
    def test_a_non_utf8_caption_does_not_break_the_folder_listing(self) -> None:
        from folder_contents import build_folder_response

        with TempMediaFolder() as root:
            broken = write_media(root, "broken.png")
            broken.with_suffix(".txt").write_bytes("caption".encode("utf-16"))
            fine = write_media(root, "fine.png")
            write_txt_caption(fine, "Readable.")

            response = build_folder_response(root, remember_last=False)

            by_name = {Path(item.path).name: item for item in response.items}
            self.assertEqual(by_name["fine.png"].description, "Readable.")
            self.assertIsNone(by_name["broken.png"].description)

    def test_non_utf8_finding_sidecars_read_as_absent(self) -> None:
        from captions import issue_file_path, load_issue_summary
        from duplicates import duplicate_file_path, duplicate_finding_from_sidecar

        with TempMediaFolder() as root:
            media = write_media(root)
            issue_file_path(media).write_bytes('{"fixes": ["x"]}'.encode("utf-16"))
            duplicate_file_path(media).write_bytes(bytes([0xFF, 0xFE, 0x00]) + b"garbage")

            load_issue_summary(media)
            sidecar = duplicate_file_path(media)
            stat = sidecar.stat()
            self.assertIsNone(
                duplicate_finding_from_sidecar(sidecar, stat.st_mtime_ns, stat.st_size)
            )


if __name__ == "__main__":
    unittest.main()
