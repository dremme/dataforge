"""Malformed or oversized media metadata yields an unreadable result, never an exception."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import struct
import unittest
import zlib
from unittest.mock import patch

import comfy_metadata
from caption_cache import clear_caption_cache_for_tests
from comfy_metadata import _parse_png_text_chunks
from media_dimensions import media_info
from testing_fixtures import TempMediaFolder, make_png_bytes, png_chunk


def _box(kind: bytes, payload: bytes = b"") -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def _with_chunks(*chunks: bytes) -> bytes:
    png = make_png_bytes()
    # Signature (8) plus IHDR (12 + 13 bytes of payload).
    return png[:33] + b"".join(chunks) + png[33:]


class MalformedVideoHeaderTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def test_an_empty_track_header_reads_as_no_dimensions(self) -> None:
        moov = _box(b"moov", _box(b"trak", _box(b"tkhd")))
        with TempMediaFolder() as root:
            video = root / "clip.mp4"
            video.write_bytes(_box(b"ftyp", b"isom\x00\x00\x02\x00") + moov)
            stat = video.stat()

            info = media_info(video, "video", stat.st_mtime_ns, stat.st_size)

        self.assertIsNone(info.width)


class MalformedPngTextTests(unittest.TestCase):
    def test_an_itxt_cut_off_after_its_flag_is_skipped(self) -> None:
        data = _with_chunks(png_chunk(b"iTXt", b"workflow\x00\x01"))

        self.assertEqual(_parse_png_text_chunks(data), {})


class CompressedPngTextBudgetTests(unittest.TestCase):
    def test_a_chunk_that_expands_past_the_budget_is_skipped(self) -> None:
        bomb = zlib.compress(b"x" * 4096)
        data = _with_chunks(
            png_chunk(b"zTXt", b"prompt\x00\x00" + bomb),
            png_chunk(b"iTXt", b"workflow\x00\x01\x00\x00\x00" + bomb),
            png_chunk(b"tEXt", b"parameters\x00kept"),
        )

        with patch.object(comfy_metadata, "_MAX_TEXT_BYTES", 1024):
            values = _parse_png_text_chunks(data)

        self.assertEqual(values, {"parameters": "kept"})

    def test_chunks_that_fit_alone_still_share_one_budget(self) -> None:
        text = zlib.compress(b"y" * 600)
        data = _with_chunks(
            png_chunk(b"zTXt", b"first\x00\x00" + text),
            png_chunk(b"zTXt", b"second\x00\x00" + text),
        )

        with patch.object(comfy_metadata, "_MAX_TEXT_BYTES", 1024):
            values = _parse_png_text_chunks(data)

        self.assertEqual(list(values), ["first"])

    def test_an_ordinary_compressed_workflow_still_reads(self) -> None:
        data = _with_chunks(png_chunk(b"zTXt", b"prompt\x00\x00" + zlib.compress(b'{"1": {}}')))

        self.assertEqual(_parse_png_text_chunks(data), {"prompt": '{"1": {}}'})


if __name__ == "__main__":
    unittest.main()
