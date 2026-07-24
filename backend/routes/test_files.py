"""Tests for /api/files/import*."""

from __future__ import annotations

import io
import json
import unittest
from urllib.parse import quote

from constants import SYSPROMPT_FILENAME
from routes._test_client import client
from testing_fixtures import TempMediaFolder, make_png_bytes, write_media


class FileImportPreviewEndpointTests(unittest.TestCase):
    def test_classifies_importable_conflicts_and_rejected_files(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "existing.png")

            response = client.post(
                f"/api/files/import/preview?path={quote(str(root))}",
                json={
                    "filenames": [
                        "existing.png",
                        "new.jpg",
                        "notes.md",
                        SYSPROMPT_FILENAME,
                        "caption.txt",
                    ]
                },
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(
                payload["importable"],
                [
                    "existing.png",
                    "new.jpg",
                    SYSPROMPT_FILENAME,
                    "caption.txt",
                ],
            )
            self.assertEqual(payload["new_files"], ["new.jpg", SYSPROMPT_FILENAME, "caption.txt"])
            self.assertEqual(payload["conflicts"], ["existing.png"])
            self.assertEqual(payload["rejected"], ["notes.md"])


class FileImportEndpointTests(unittest.TestCase):
    def test_copies_only_new_files_when_not_overwriting(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "existing.png")

            files = [
                ("files", ("existing.png", io.BytesIO(b"new-bytes"), "image/png")),
                ("files", ("fresh.png", io.BytesIO(make_png_bytes()), "image/png")),
                ("files", ("notes.md", io.BytesIO(b"skip"), "text/plain")),
            ]

            response = client.post(
                f"/api/files/import?path={quote(str(root))}&overwrite=false",
                files=files,
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["copied"], ["fresh.png"])
            self.assertEqual(payload["skipped"], ["existing.png"])
            self.assertEqual(payload["rejected"], ["notes.md"])
            self.assertEqual((root / "existing.png").read_bytes()[:4], b"\x89PNG")
            self.assertTrue((root / "fresh.png").is_file())

    def test_overwrites_existing_files_when_requested(self) -> None:
        with TempMediaFolder() as root:
            existing = write_media(root, "existing.png")
            existing.write_bytes(b"old")

            files = [
                ("files", ("existing.png", io.BytesIO(b"replaced"), "image/png")),
                (
                    "files",
                    ("caption.json", io.BytesIO(b'{"description":"New"}'), "application/json"),
                ),
            ]

            response = client.post(
                f"/api/files/import?path={quote(str(root))}&overwrite=true",
                files=files,
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["copied"], ["existing.png", "caption.json"])
            self.assertEqual(payload["skipped"], [])
            self.assertEqual((root / "existing.png").read_bytes(), b"replaced")
            self.assertEqual(
                json.loads((root / "caption.json").read_text(encoding="utf-8"))["description"],
                "New",
            )

    def test_imports_sysprompt_file(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                f"/api/files/import?path={quote(str(root))}",
                files=[
                    (
                        "files",
                        (
                            SYSPROMPT_FILENAME,
                            io.BytesIO(b"Describe the scene."),
                            "text/plain",
                        ),
                    )
                ],
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["copied"], [SYSPROMPT_FILENAME])
            self.assertEqual(
                (root / SYSPROMPT_FILENAME).read_text(encoding="utf-8"),
                "Describe the scene.",
            )


if __name__ == "__main__":
    unittest.main()
