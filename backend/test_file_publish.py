from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from file_publish import publish_replacing
from testing_fixtures import TempMediaFolder


def _names(root: Path, name: str) -> tuple[Path, Path, Path]:
    final_path = root / name
    return (
        root / f"{name}.publish-tmp",
        final_path,
        root / f"{name}.publish-stale",
    )


def _denying_replace(*failing_calls: int):
    """A stand-in for ``os.replace`` that refuses the given call ordinals."""
    calls = {"count": 0}
    real_replace = os.replace

    def replace(source: str | os.PathLike[str], dest: str | os.PathLike[str]) -> None:
        calls["count"] += 1
        if calls["count"] in failing_calls:
            raise PermissionError(13, "Access is denied")
        real_replace(source, dest)

    return replace


class PublishReplacingTests(unittest.TestCase):
    def test_replaces_when_the_destination_is_free(self) -> None:
        with TempMediaFolder() as root:
            temp_path, final_path, stale_path = _names(root, "photo.png")
            final_path.write_bytes(b"old")
            temp_path.write_bytes(b"new")

            publish_replacing(temp_path, final_path, stale_path)

            self.assertEqual(final_path.read_bytes(), b"new")
            self.assertFalse(temp_path.exists())
            self.assertFalse(stale_path.exists())

    def test_creates_a_destination_that_does_not_exist_yet(self) -> None:
        with TempMediaFolder() as root:
            temp_path, final_path, stale_path = _names(root, "photo.png")
            temp_path.write_bytes(b"new")

            publish_replacing(temp_path, final_path, stale_path)

            self.assertEqual(final_path.read_bytes(), b"new")

    def test_falls_back_when_direct_replace_is_denied(self) -> None:
        """Windows can refuse ``os.replace`` onto a streamed destination (WinError 5)."""
        with TempMediaFolder() as root:
            temp_path, final_path, stale_path = _names(root, "photo.png")
            final_path.write_bytes(b"old")
            temp_path.write_bytes(b"new")

            with patch("file_publish.os.replace", side_effect=_denying_replace(1)):
                publish_replacing(temp_path, final_path, stale_path)

            self.assertEqual(final_path.read_bytes(), b"new")
            self.assertFalse(temp_path.exists())
            self.assertFalse(stale_path.exists())

    def test_restores_the_previous_output_when_install_fails(self) -> None:
        with TempMediaFolder() as root:
            temp_path, final_path, stale_path = _names(root, "photo.png")
            final_path.write_bytes(b"old")
            temp_path.write_bytes(b"new")

            # Call 1 is the direct attempt, call 2 parks the destination, call 3 installs.
            with patch("file_publish.os.replace", side_effect=_denying_replace(1, 3)):
                with self.assertRaises(OSError):
                    publish_replacing(temp_path, final_path, stale_path)

            self.assertEqual(final_path.read_bytes(), b"old")
            self.assertTrue(temp_path.exists())
            self.assertFalse(stale_path.exists())

    def test_reraises_when_the_destination_is_genuinely_absent(self) -> None:
        """A denied replace onto nothing is a real fault, not a locked destination."""
        with TempMediaFolder() as root:
            temp_path, final_path, stale_path = _names(root, "photo.png")
            temp_path.write_bytes(b"new")

            with patch("file_publish.os.replace", side_effect=_denying_replace(1)):
                with self.assertRaises(PermissionError):
                    publish_replacing(temp_path, final_path, stale_path)

            self.assertFalse(stale_path.exists())

    def test_overwrites_a_leftover_stale_file(self) -> None:
        with TempMediaFolder() as root:
            temp_path, final_path, stale_path = _names(root, "photo.png")
            final_path.write_bytes(b"old")
            temp_path.write_bytes(b"new")
            stale_path.write_bytes(b"leftover")

            with patch("file_publish.os.replace", side_effect=_denying_replace(1)):
                publish_replacing(temp_path, final_path, stale_path)

            self.assertEqual(final_path.read_bytes(), b"new")
            self.assertFalse(stale_path.exists())

    @unittest.skipUnless(sys.platform == "win32", "FILE_SHARE_DELETE is a Windows concern")
    def test_replaces_a_destination_open_for_shared_read(self) -> None:
        """Matches a gallery video still streaming the file being replaced."""
        from media_file_response import open_shared_read

        with TempMediaFolder() as root:
            temp_path, final_path, stale_path = _names(root, "clip.mp4")
            final_path.write_bytes(b"old-bytes")
            temp_path.write_bytes(b"new-bytes")

            with open_shared_read(final_path) as handle:
                handle.read(1)
                publish_replacing(temp_path, final_path, stale_path)

            self.assertEqual(final_path.read_bytes(), b"new-bytes")
            self.assertFalse(temp_path.exists())
            self.assertFalse(stale_path.exists())


if __name__ == "__main__":
    unittest.main()
