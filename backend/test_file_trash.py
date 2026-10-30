from __future__ import annotations

import struct
import sys
import unittest
from unittest.mock import patch

from file_trash import delete_path, parse_recycle_record, restore_from_trash
from testing_fixtures import TempMediaFolder, write_media

ORIGINAL = "C:\\Data\\set\\sunset.png"


def _v1_record(path: str, deleted_at: int = 7) -> bytes:
    field = path.encode("utf-16-le").ljust(520, b"\0")
    return struct.pack("<qqq", 1, 1234, deleted_at) + field


def _v2_record(path: str, deleted_at: int = 7) -> bytes:
    encoded = (path + "\0").encode("utf-16-le")
    return struct.pack("<qqqi", 2, 1234, deleted_at, len(path) + 1) + encoded


class ParseRecycleRecordTests(unittest.TestCase):
    def test_reads_both_record_versions(self) -> None:
        for build in (_v1_record, _v2_record):
            with self.subTest(version=build.__name__):
                self.assertEqual(parse_recycle_record(build(ORIGINAL, 99)), (ORIGINAL, 99))

    def test_rejects_what_is_not_a_record(self) -> None:
        for data in (b"", b"short", struct.pack("<qqq", 3, 0, 0) + b"\0" * 8):
            with self.subTest(data=data):
                self.assertIsNone(parse_recycle_record(data))


class RestoreFromTrashTests(unittest.TestCase):
    def test_nothing_to_restore_where_deletes_are_permanent(self) -> None:
        with TempMediaFolder() as root:
            media = root / "sunset.png"

            with patch("file_trash.sys.platform", "linux"):
                self.assertFalse(restore_from_trash(media))

    @unittest.skipUnless(sys.platform == "win32", "Recycle Bin is a Windows concern")
    def test_round_trips_through_the_recycle_bin(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            original = media.read_bytes()

            delete_path(media)
            self.assertFalse(media.exists())

            self.assertTrue(restore_from_trash(media))
            self.assertEqual(media.read_bytes(), original)
            # The record went with it, so a second undo finds nothing.
            media.unlink()
            self.assertFalse(restore_from_trash(media))

    @unittest.skipUnless(sys.platform == "win32", "Recycle Bin is a Windows concern")
    def test_never_restores_over_a_file_that_took_the_name(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            delete_path(media)
            write_media(root, "sunset.png")

            with self.assertRaises(FileExistsError):
                restore_from_trash(media)


if __name__ == "__main__":
    unittest.main()
