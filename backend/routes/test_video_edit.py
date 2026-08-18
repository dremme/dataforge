"""Tests for /api/media/video-edit."""

from __future__ import annotations

import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

import video_edit
from ffmpeg_run import FfmpegCancelled
from routes._test_client import client
from schemas import VideoEditSpec
from testing_fixtures import TempMediaFolder, write_gif, write_media, write_mp4_video

EDIT_URL = "/api/media/video-edit"


def edit_url(media: Path, suffix: str = "", **params: str) -> str:
    query = "&".join(f"{key}={quote(value)}" for key, value in params.items())
    base = f"{EDIT_URL}{suffix}?path={quote(str(media))}"
    return f"{base}&{query}" if query else base


def render_into(command, **_kwargs) -> None:
    Path(command[-1]).write_bytes(b"rendered-bytes")


class VideoEditStateTests(unittest.TestCase):
    def test_an_unedited_video_reports_no_backup_and_no_spec(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            response = client.get(edit_url(media))

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(media))
            self.assertFalse(payload["has_backup"])
            self.assertIsNone(payload["spec"])

    def test_an_edited_video_reports_the_spec_it_was_rendered_with(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            video_edit.backup_path_for(media).write_bytes(b"original")
            video_edit.write_edit_spec(media, VideoEditSpec(trim_start=1.0, trim_end=4.0))

            payload = client.get(edit_url(media)).json()

            self.assertTrue(payload["has_backup"])
            self.assertEqual(payload["spec"]["trim_start"], 1.0)
            self.assertEqual(payload["spec"]["trim_end"], 4.0)

    def test_a_missing_file_is_a_404(self) -> None:
        with TempMediaFolder() as root:
            response = client.get(edit_url(root / "missing.mp4"))

            self.assertEqual(response.status_code, 404)

    def test_an_uneditable_container_is_a_400(self) -> None:
        with TempMediaFolder() as root:
            media = root / "clip.avi"
            media.write_bytes(b"\x00" * 16)

            response = client.get(edit_url(media))

            self.assertEqual(response.status_code, 400)

    def test_a_still_image_is_a_400(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            self.assertEqual(client.get(edit_url(media)).status_code, 400)

    def test_a_gif_is_a_400(self) -> None:
        """GIF keeps frame capture; editing it would need a palette pass of its own."""
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            self.assertEqual(client.get(edit_url(media)).status_code, 400)


class ApplyVideoEditTests(unittest.TestCase):
    def test_a_valid_spec_renders_and_reports_the_new_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.run_ffmpeg", side_effect=render_into):
                response = client.post(
                    edit_url(media), json={"trim_start": 1.0, "trim_end": 4.0, "speed": 2.0}
                )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(media))
            self.assertTrue(payload["has_backup"])
            self.assertEqual(payload["size"], len(b"rendered-bytes"))
            self.assertEqual(media.read_bytes(), b"rendered-bytes")

    def test_the_spec_survives_for_the_next_time_the_editor_opens(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.run_ffmpeg", side_effect=render_into):
                client.post(edit_url(media), json={"scale": 0.5})

            self.assertEqual(client.get(edit_url(media)).json()["spec"]["scale"], 0.5)

    def test_an_edit_that_changes_nothing_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.run_ffmpeg") as runner:
                response = client.post(edit_url(media), json={})

            self.assertEqual(response.status_code, 400)
            runner.assert_not_called()

    def test_a_full_frame_crop_counts_as_no_crop_at_all(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            response = client.post(
                edit_url(media),
                json={"crop": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}},
            )

            self.assertEqual(response.status_code, 400)

    def test_an_out_of_range_speed_is_rejected_by_the_schema(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            self.assertEqual(client.post(edit_url(media), json={"speed": 10}).status_code, 422)

    def test_a_crop_reaching_past_the_frame_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            response = client.post(
                edit_url(media),
                json={"crop": {"x": 0.6, "y": 0.0, "width": 0.5, "height": 1.0}},
            )

            self.assertEqual(response.status_code, 422)

    def test_a_backwards_trim_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            response = client.post(edit_url(media), json={"trim_start": 4.0, "trim_end": 1.0})

            self.assertEqual(response.status_code, 422)

    def test_a_missing_ffmpeg_is_a_503(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.ffmpeg_path", return_value=None):
                response = client.post(edit_url(media), json={"scale": 0.5})

            self.assertEqual(response.status_code, 503)

    def test_an_ffmpeg_failure_surfaces_its_own_message(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.run_ffmpeg", side_effect=RuntimeError("Invalid filter")):
                response = client.post(edit_url(media), json={"scale": 0.5})

            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.json()["detail"], "Invalid filter")

    def test_a_cancelled_render_answers_409(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.run_ffmpeg", side_effect=FfmpegCancelled):
                response = client.post(edit_url(media), json={"scale": 0.5})

            self.assertEqual(response.status_code, 409)

    def test_a_second_render_of_the_same_file_answers_409(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            started = threading.Event()
            release = threading.Event()
            second: dict[str, int] = {}

            def blocking_render(command, **kwargs):
                started.set()
                release.wait(timeout=5)
                render_into(command, **kwargs)

            def post_second() -> None:
                started.wait(timeout=5)
                second["status"] = client.post(edit_url(media), json={"speed": 2.0}).status_code
                release.set()

            with patch("video_edit.run_ffmpeg", side_effect=blocking_render):
                worker = threading.Thread(target=post_second)
                worker.start()
                first = client.post(edit_url(media), json={"scale": 0.5})
                worker.join(timeout=5)

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second["status"], 409)

    def test_progress_reaches_only_the_tab_that_asked(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            published: list[tuple[list[str], dict]] = []

            def render_with_progress(command, **kwargs):
                on_progress = kwargs.get("on_progress")
                assert on_progress is not None
                on_progress(1.25)
                render_into(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=render_with_progress):
                with patch(
                    "routes.media.events.publish_to_tabs",
                    side_effect=lambda tabs, event: published.append((list(tabs), event)),
                ):
                    client.post(
                        edit_url(media, tab="tab-7"),
                        json={"trim_start": 0.0, "trim_end": 4.0, "speed": 2.0},
                    )

            self.assertEqual(len(published), 1)
            tabs, event = published[0]
            self.assertEqual(tabs, ["tab-7"])
            self.assertEqual(event["type"], "video_edit")
            self.assertEqual(event["path"], str(media))
            self.assertEqual(event["seconds"], 1.25)
            self.assertEqual(event["duration"], 2.0)

    def test_no_tab_means_no_progress_frames(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            reported: list[object] = []

            def render(command, **kwargs):
                reported.append(kwargs.get("on_progress"))
                render_into(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=render):
                client.post(edit_url(media), json={"scale": 0.5})

            self.assertEqual(reported, [None])


class CancelVideoEditTests(unittest.TestCase):
    def test_cancelling_an_idle_file_is_not_an_error(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            response = client.post(edit_url(media, "/cancel"))

            self.assertEqual(response.status_code, 204)

    def test_cancelling_stops_the_running_render(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            started = threading.Event()

            def watch_for_cancel(command, **kwargs):
                should_cancel = kwargs["should_cancel"]
                started.set()
                for _ in range(500):
                    if should_cancel():
                        raise FfmpegCancelled
                    threading.Event().wait(0.01)
                render_into(command, **kwargs)

            def cancel_once_started() -> None:
                started.wait(timeout=5)
                client.post(edit_url(media, "/cancel"))

            with patch("video_edit.run_ffmpeg", side_effect=watch_for_cancel):
                worker = threading.Thread(target=cancel_once_started)
                worker.start()
                response = client.post(edit_url(media), json={"scale": 0.5})
                worker.join(timeout=5)

            self.assertEqual(response.status_code, 409)


class RevertVideoEditTests(unittest.TestCase):
    def test_reverting_restores_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            video_edit.backup_path_for(media).write_bytes(b"pristine-original")
            video_edit.write_edit_spec(media, VideoEditSpec(scale=0.5))

            response = client.post(edit_url(media, "/revert"))

            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["has_backup"])
            self.assertEqual(media.read_bytes(), b"pristine-original")
            self.assertFalse(video_edit.edit_spec_path(media).exists())

    def test_reverting_without_a_backup_is_a_400(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            response = client.post(edit_url(media, "/revert"))

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], video_edit.NO_BACKUP_MESSAGE)


class ServeOriginalTests(unittest.TestCase):
    def test_the_original_flag_serves_the_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            media.write_bytes(b"edited-bytes")
            video_edit.backup_path_for(media).write_bytes(b"pristine-original")

            response = client.get(f"/api/media?path={quote(str(media))}&original=1")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b"pristine-original")
            self.assertEqual(response.headers["content-type"], "video/mp4")

    def test_the_original_flag_falls_back_to_the_file_itself(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            media.write_bytes(b"never-edited")

            response = client.get(f"/api/media?path={quote(str(media))}&original=1")

            self.assertEqual(response.content, b"never-edited")

    def test_without_the_flag_the_edited_file_is_served(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            media.write_bytes(b"edited-bytes")
            video_edit.backup_path_for(media).write_bytes(b"pristine-original")

            response = client.get(f"/api/media?path={quote(str(media))}")

            self.assertEqual(response.content, b"edited-bytes")


if __name__ == "__main__":
    unittest.main()
