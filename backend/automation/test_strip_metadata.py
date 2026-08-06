"""Unit tests for strip-metadata file rewriting."""

from __future__ import annotations

import json
import unittest.mock

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from automation.strip_metadata import (
    list_strip_metadata_files,
    run_strip_metadata_job,
    strip_mp4_metadata,
    strip_png_metadata,
    validate_strip_metadata_folder,
)
from comfy_metadata import _parse_isobmff_metadata, _parse_png_text_chunks, media_has_comfy_workflow
from testing_fixtures import (
    TempMediaFolder,
    make_minimal_mp4_bytes,
    write_gif,
    write_media,
    write_mp4_video,
)


class StripMetadataFileTests(unittest.TestCase):
    def test_lists_only_png_and_mp4_files(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")
            (root / "notes.txt").write_text("ignore", encoding="utf-8")
            (root / "photo.jpg").write_bytes(b"not supported")
            # Re-encoding an animated GIF through Pillow risks palette and timing
            # loss, so it stays out until that is handled deliberately.
            write_gif(root, "loop.gif")

            files = list_strip_metadata_files(root)

            self.assertEqual({path.name for path in files}, {"photo.png", "clip.mp4"})

    def test_validate_requires_supported_files(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No PNG or MP4"):
                validate_strip_metadata_folder(root)

    def test_strip_png_metadata_removes_text_chunks(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(
                root,
                "comfy.png",
                text_chunks={"workflow": json.dumps({"nodes": {"1": {"class_type": "KSampler"}}})},
            )

            self.assertTrue(media_has_comfy_workflow(media))

            strip_png_metadata(media)

            chunks = _parse_png_text_chunks(media.read_bytes())
            self.assertEqual(chunks, {})
            self.assertFalse(media_has_comfy_workflow(media))

    def test_run_job_processes_png_and_mp4(self) -> None:
        with TempMediaFolder() as root:
            png = write_media(root, "photo.png", text_chunks={"comment": "secret"})
            write_mp4_video(
                root,
                "clip.mp4",
                metadata={"comment": "workflow prompt", "workflow": '{"nodes":{}}'},
            )

            with unittest.mock.patch(
                "automation.strip_metadata.strip_mp4_metadata",
                side_effect=lambda path, ffmpeg=None: None,
            ) as strip_mp4:
                result = run_strip_metadata_job(root)

            strip_mp4.assert_called_once()
            self.assertEqual(result["total"], 2)
            self.assertEqual(result["stats"]["success"], 2)
            self.assertEqual(result["stats"]["png_success"], 1)
            self.assertEqual(result["stats"]["mp4_success"], 1)
            self.assertEqual(_parse_png_text_chunks(png.read_bytes()), {})


class StripMp4MetadataTests(unittest.TestCase):
    def test_requires_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            with unittest.mock.patch("automation.strip_metadata._ffmpeg_path", return_value=None):
                with self.assertRaisesRegex(RuntimeError, "ffmpeg is required"):
                    strip_mp4_metadata(media)

    def test_strips_metadata_with_ffmpeg_copy(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4", metadata={"comment": "secret"})
            self.assertEqual(_parse_isobmff_metadata(media.read_bytes()).get("comment"), "secret")

            fake_ffmpeg = root / "ffmpeg.exe"
            fake_ffmpeg.write_text("", encoding="utf-8")

            def fake_run(command, *_args, **_kwargs):
                from pathlib import Path

                output_path = Path(command[-1])
                output_path.write_bytes(make_minimal_mp4_bytes())
                return unittest.mock.Mock(returncode=0, stderr=b"")

            with unittest.mock.patch(
                "automation.strip_metadata.subprocess.run", side_effect=fake_run
            ):
                strip_mp4_metadata(media, ffmpeg=str(fake_ffmpeg))

            self.assertFalse(_parse_isobmff_metadata(media.read_bytes()))

    def test_run_job_reports_ffmpeg_errors(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4", metadata={"comment": "secret"})

            with unittest.mock.patch(
                "automation.strip_metadata.strip_mp4_metadata",
                side_effect=RuntimeError("ffmpeg failed to strip MP4 metadata"),
            ):
                result = run_strip_metadata_job(root)

            self.assertEqual(result["stats"]["ffmpeg_error"], 1)
            self.assertEqual(result["results"][0]["status"], "ffmpeg_error")


if __name__ == "__main__":
    unittest.main()
