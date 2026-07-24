"""Tests for /api/media and /api/thumbnail."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from routes._test_client import client
from testing_fixtures import TempMediaFolder, write_media, write_mp4_video, write_txt_caption
from thumbnails import get_thumbnail_cache_dir


class MediaEndpointTests(unittest.TestCase):
    def test_serves_image_bytes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            response = client.get(f"/api/media?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b"\x89PNG"))

    def test_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.get(f"/api/media?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_returns_400_for_unsupported_extension(self) -> None:
        with TempMediaFolder() as root:
            file_path = root / "notes.md"
            file_path.write_text("not media", encoding="utf-8")

            response = client.get(f"/api/media?path={quote(str(file_path))}")

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Not a supported media file")

    def test_deletes_media_and_sidecars(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            write_txt_caption(media, "Golden hour.")
            media.with_suffix(".json").write_text('{"description":"JSON"}', encoding="utf-8")

            response = client.delete(f"/api/media?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(media))
            self.assertEqual(
                set(payload["deleted"]),
                {"sunset.png", "sunset.txt", "sunset.json"},
            )
            self.assertFalse(media.exists())
            self.assertFalse(media.with_suffix(".txt").exists())
            self.assertFalse(media.with_suffix(".json").exists())

    def test_delete_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.delete(f"/api/media?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_opens_image_in_default_viewer(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch("routes.media.open_file_in_default_viewer") as open_viewer:
                response = client.post(f"/api/media/open?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["path"], str(media))
            open_viewer.assert_called_once()

    def test_open_returns_404_for_missing_image(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.post(f"/api/media/open?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_open_rejects_videos(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root)

            response = client.post(f"/api/media/open?path={quote(str(video))}")

            self.assertEqual(response.status_code, 400)
            self.assertEqual(
                response.json()["detail"],
                "Only image files can be opened in the image viewer",
            )

    def test_open_returns_500_when_viewer_fails(self) -> None:
        from filesystem import MediaPreviewError

        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with patch(
                "routes.media.open_file_in_default_viewer",
                side_effect=MediaPreviewError("Default viewer is not available on this system"),
            ):
                response = client.post(f"/api/media/open?path={quote(str(media))}")

            self.assertEqual(response.status_code, 500)
            self.assertEqual(
                response.json()["detail"],
                "Default viewer is not available on this system",
            )


class MediaMoveEndpointTests(unittest.TestCase):
    def test_moves_selected_files_to_destination_folder(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")

            preview_response = client.post(
                f"/api/media/move/preview?destination={quote(str(destination_dir))}",
                json={"paths": [str(media)]},
            )
            self.assertEqual(preview_response.status_code, 200)
            self.assertEqual(preview_response.json()["movable"], ["sunset.png"])

            move_response = client.post(
                f"/api/media/move?destination={quote(str(destination_dir))}",
                json={"paths": [str(media)]},
            )

            self.assertEqual(move_response.status_code, 200)
            payload = move_response.json()
            self.assertEqual(len(payload["moved"]), 1)
            self.assertEqual(
                payload["moved"][0]["destination"], str(destination_dir / "sunset.png")
            )
            self.assertFalse(media.exists())
            self.assertTrue((destination_dir / "sunset.png").is_file())
            self.assertTrue((destination_dir / "sunset.txt").is_file())

    def test_move_preview_reports_conflicts(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            source = write_media(source_dir, "sunset.png")
            write_media(destination_dir, "sunset.png")

            response = client.post(
                f"/api/media/move/preview?destination={quote(str(destination_dir))}",
                json={"paths": [str(source)]},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["conflicts"], ["sunset.png"])


class ThumbnailEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self._cache_dir = tempfile.TemporaryDirectory(prefix="dataforge-thumb-cache-")
        self._cache_env = patch.dict(
            "os.environ",
            {"DATAFORGE_THUMBNAIL_CACHE": self._cache_dir.name},
        )
        self._cache_env.start()

    def tearDown(self) -> None:
        self._cache_env.stop()
        self._cache_dir.cleanup()

    def test_serves_image_thumbnail_bytes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png", width=320, height=240)

            response = client.get(f"/api/thumbnail?path={quote(str(media))}&w=180")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "image/webp")
            self.assertIn("max-age=31536000", response.headers["cache-control"])
            content = response.content
            self.assertTrue(content.startswith(b"RIFF") and b"WEBP" in content[:16])

    def test_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.get(f"/api/thumbnail?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_returns_404_when_video_thumbnail_is_unavailable(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root)

            with patch("thumbnails._ffmpeg_path", return_value=None):
                response = client.get(f"/api/thumbnail?path={quote(str(video))}")

            self.assertEqual(response.status_code, 404)
            self.assertIn("ffmpeg", response.json()["detail"].lower())

    def test_ignores_client_cache_busting_token(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)

            first = client.get(f"/api/thumbnail?path={quote(str(media))}&v=111")
            second = client.get(f"/api/thumbnail?path={quote(str(media))}&v=222")

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(first.content, second.content)

    def test_uses_isolated_thumbnail_cache_directory(self) -> None:
        self.assertEqual(get_thumbnail_cache_dir(), Path(self._cache_dir.name))


if __name__ == "__main__":
    unittest.main()
