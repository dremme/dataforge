"""Tests for /api/media and /api/thumbnail."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from gif_frames import clear_gif_caches_for_tests
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_media,
    write_mp4_video,
    write_txt_caption,
)
from thumbnails import get_thumbnail_cache_dir


class MediaEndpointTests(unittest.TestCase):
    def test_serves_image_bytes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            response = client.get(f"/api/media?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b"\x89PNG"))

    def test_unversioned_media_must_be_revalidated(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            response = client.get(f"/api/media?path={quote(str(media))}")

            # Heuristic freshness would otherwise serve an edited file's old bytes.
            self.assertIn("no-cache", response.headers["cache-control"])

    def test_versioned_media_is_cached_hard(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            response = client.get(f"/api/media?path={quote(str(media))}&v=123-4096")

            self.assertEqual(response.status_code, 200)
            self.assertIn("max-age=31536000", response.headers["cache-control"])

    def test_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.get(f"/api/media?path={quote(str(missing))}")

            self.assertEqual(response.status_code, 404)

    def test_optional_request_returns_204_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.get(f"/api/media?path={quote(str(missing))}&optional=1")

            # A browser logs a 404 on an <img> itself, which JavaScript cannot suppress.
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.content, b"")
            self.assertEqual(response.headers["cache-control"], "no-store")

    def test_optional_request_still_serves_a_file_that_is_there(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            response = client.get(f"/api/media?path={quote(str(media))}&optional=1")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b"\x89PNG"))

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
            self.assertEqual(preview_response.json()["eligible"], ["sunset.png"])

            move_response = client.post(
                f"/api/media/move?destination={quote(str(destination_dir))}",
                json={"paths": [str(media)]},
            )

            self.assertEqual(move_response.status_code, 200)
            payload = move_response.json()
            self.assertEqual(len(payload["transferred"]), 1)
            self.assertEqual(
                payload["transferred"][0]["destination"], str(destination_dir / "sunset.png")
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


class MediaCopyEndpointTests(unittest.TestCase):
    def test_copies_selected_files_and_keeps_the_originals(self) -> None:
        with TempMediaFolder() as root:
            source_dir = root / "Source"
            destination_dir = root / "Destination"
            source_dir.mkdir()
            destination_dir.mkdir()

            media = write_media(source_dir, "sunset.png")
            write_txt_caption(media, "Golden hour.")

            preview_response = client.post(
                f"/api/media/copy/preview?destination={quote(str(destination_dir))}",
                json={"paths": [str(media)]},
            )
            self.assertEqual(preview_response.status_code, 200)
            self.assertEqual(preview_response.json()["eligible"], ["sunset.png"])

            copy_response = client.post(
                f"/api/media/copy?destination={quote(str(destination_dir))}",
                json={"paths": [str(media)]},
            )

            self.assertEqual(copy_response.status_code, 200)
            payload = copy_response.json()
            self.assertEqual(len(payload["transferred"]), 1)
            self.assertEqual(
                payload["transferred"][0]["destination"], str(destination_dir / "sunset.png")
            )
            self.assertEqual(
                set(payload["transferred"][0]["files"]),
                {"sunset.png", "sunset.txt"},
            )

            self.assertTrue((destination_dir / "sunset.png").is_file())
            self.assertTrue((destination_dir / "sunset.txt").is_file())
            self.assertTrue(media.is_file())
            self.assertTrue(media.with_suffix(".txt").is_file())

    def test_copy_requires_at_least_one_path(self) -> None:
        with TempMediaFolder() as root:
            destination_dir = root / "Destination"
            destination_dir.mkdir()

            response = client.post(
                f"/api/media/copy?destination={quote(str(destination_dir))}",
                json={"paths": []},
            )

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "No files were provided")

    def test_copy_skips_files_already_in_the_destination(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            response = client.post(
                f"/api/media/copy?destination={quote(str(root))}",
                json={"paths": [str(media)]},
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["transferred"], [])
            self.assertEqual(payload["skipped"], [str(media.resolve())])


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

    def test_optional_request_returns_204_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "missing.png"

            response = client.get(f"/api/thumbnail?path={quote(str(missing))}&optional=1")

            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.content, b"")
            self.assertEqual(response.headers["cache-control"], "no-store")

    def test_optional_request_returns_204_when_video_thumbnail_is_unavailable(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root)

            with patch("thumbnails._ffmpeg_path", return_value=None):
                response = client.get(f"/api/thumbnail?path={quote(str(video))}&optional=1")

            self.assertEqual(response.status_code, 204)

    def test_optional_request_still_serves_a_file_that_is_there(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png", width=320, height=240)

            response = client.get(f"/api/thumbnail?path={quote(str(media))}&w=180&optional=1")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "image/webp")

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

    def test_renders_a_gif_poster_without_ffmpeg(self) -> None:
        # A GIF decodes in Pillow, so it must never reach the video branch.
        with TempMediaFolder() as root:
            media = write_gif(root, frames=8)

            with patch("thumbnails._ffmpeg_path", return_value=None):
                response = client.get(f"/api/thumbnail?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "image/webp")


class GifInfoEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_gif_caches_for_tests()

    def test_reports_the_frame_count(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=24)

            response = client.get(f"/api/gif-info?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"frame_count": 24})

    def test_rejects_media_that_is_not_a_gif(self) -> None:
        with TempMediaFolder() as root:
            for media in (write_media(root, "sunset.png"), write_mp4_video(root)):
                response = client.get(f"/api/gif-info?path={quote(str(media))}")

                self.assertEqual(response.status_code, 400)

    def test_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            response = client.get(f"/api/gif-info?path={quote(str(root / 'missing.gif'))}")

            self.assertEqual(response.status_code, 404)


class GifFrameEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_gif_caches_for_tests()

    def test_serves_a_frame_as_jpeg(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=24)

            response = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=7")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "image/jpeg")
            self.assertTrue(response.content.startswith(b"\xff\xd8"))

    def test_defaults_to_the_first_frame(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=6)

            default = client.get(f"/api/gif-frame?path={quote(str(media))}")
            explicit = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=0")

            self.assertEqual(default.status_code, 200)
            self.assertEqual(default.content, explicit.content)

    def test_serves_different_bytes_for_different_frames(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            first = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=0")
            last = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=11")

            self.assertNotEqual(first.content, last.content)

    def test_returns_404_for_a_frame_past_the_end(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=5)

            response = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=5")

            self.assertEqual(response.status_code, 404)

    def test_rejects_a_negative_frame_index(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=5)

            response = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=-1")

            self.assertEqual(response.status_code, 422)

    def test_rejects_media_that_is_not_a_gif(self) -> None:
        with TempMediaFolder() as root:
            for media in (write_media(root, "sunset.png"), write_mp4_video(root)):
                response = client.get(f"/api/gif-frame?path={quote(str(media))}")

                self.assertEqual(response.status_code, 400)

    def test_returns_404_for_missing_media(self) -> None:
        with TempMediaFolder() as root:
            response = client.get(f"/api/gif-frame?path={quote(str(root / 'missing.gif'))}")

            self.assertEqual(response.status_code, 404)

    def test_answers_204_for_optional_requests_that_cannot_be_served(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=4)

            missing = client.get(
                f"/api/gif-frame?path={quote(str(root / 'missing.gif'))}&optional=1"
            )
            past_end = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=9&optional=1")

            self.assertEqual(missing.status_code, 204)
            self.assertEqual(past_end.status_code, 204)

    def test_caches_hard_only_when_versioned(self) -> None:
        # The save re-reads the URL the preview painted, so a versioned frame has
        # to be a cache hit rather than a second decode.
        with TempMediaFolder() as root:
            media = write_gif(root, frames=4)

            versioned = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=1&v=abc")
            plain = client.get(f"/api/gif-frame?path={quote(str(media))}&frame=1")

            self.assertIn("immutable", versioned.headers["cache-control"])
            self.assertIn("no-cache", plain.headers["cache-control"])


if __name__ == "__main__":
    unittest.main()
