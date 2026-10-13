from __future__ import annotations

import time
import unittest
from pathlib import Path
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.rename_media import run_rename_media_job
from constants import VIDEO_PROJECT_EXPORT_TEMP_SUFFIX
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled
from media_delete import delete_media_with_sidecars
from media_transfer import transfer_media_batch
from schemas import VideoProject, VideoProjectExportState
from testing_fixtures import TempMediaFolder, playable_video_bytes, write_image
from video_project import new_project_for_video, snapshot_path_for
from video_project_export import (
    ExportManager,
    allocate_output_name,
    name_is_taken,
    sanitize_output_stem,
)


def write_video(root: Path, name: str = "clip.mp4") -> Path:
    media = root / name
    media.write_bytes(playable_video_bytes(audio=True, duration=1))
    return media


def wait_for(manager: ExportManager, export_id: str) -> VideoProjectExportState:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        state = next(s for s in manager.list_exports() if s.id == export_id)
        if state.status != "running":
            return state
        time.sleep(0.05)
    raise AssertionError("The export did not finish")


class OutputNameTests(unittest.TestCase):
    def test_requested_names_lose_unsafe_characters_and_any_media_extension(self) -> None:
        self.assertEqual(sanitize_output_stem("my/clip.mov", "fallback"), "my-clip")
        self.assertEqual(sanitize_output_stem("final cut", "fallback"), "final cut")
        self.assertEqual(sanitize_output_stem("  ", "fallback"), "fallback")

    def test_any_related_file_makes_a_name_taken(self) -> None:
        with TempMediaFolder() as root:
            self.assertFalse(name_is_taken(root, "clip-edited.mp4", set()))

            for blocker in (
                "clip-edited.txt",
                "clip-edited.mp4.video-project.json",
                "clip-edited.mp4.bak",
                "clip-edited.png",
            ):
                with self.subTest(blocker=blocker):
                    path = root / blocker
                    path.write_bytes(b"x")
                    self.assertTrue(name_is_taken(root, "clip-edited.mp4", set()))
                    path.unlink()

            self.assertTrue(name_is_taken(root, "clip-edited.mp4", {"clip-edited.mp4"}))

    def test_a_taken_name_moves_on_to_the_next_number(self) -> None:
        with TempMediaFolder() as root:
            (root / "clip-edited.mp4").write_bytes(b"x")
            (root / "clip-edited-2.txt").write_text("caption", encoding="utf-8")

            self.assertEqual(allocate_output_name(root, "clip-edited", set()), "clip-edited-3.mp4")


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class ExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manager = ExportManager()
        events = patch("video_project_export.events.publish")
        notes = patch("video_project_export.notifications.record_notification")
        self.published = events.start()
        self.notified = notes.start()
        self.addCleanup(events.stop)
        self.addCleanup(notes.stop)

    def project(self, root: Path, **export) -> tuple[Path, VideoProject]:
        media = write_video(root)
        project = new_project_for_video(media)
        return media, project.model_copy(
            update={"export": project.export.model_copy(update=export)}
        )

    def test_an_export_publishes_a_video_and_its_snapshot_and_leaves_the_sources(self) -> None:
        with TempMediaFolder() as root:
            media, project = self.project(root)
            (root / "clip.txt").write_text("A caption.", encoding="utf-8")
            before = media.read_bytes()

            state = wait_for(self.manager, self.manager.start(root, project, None).id)

            self.assertEqual(state.status, "completed", state.error)
            output = root / "clip-edited.mp4"
            self.assertEqual(state.output_path, str(output))
            self.assertTrue(output.stat().st_size > 0)
            recorded = VideoProject.model_validate_json(
                snapshot_path_for(output).read_text(encoding="utf-8")
            )
            self.assertEqual(recorded.export.filename, "clip-edited.mp4")
            self.assertEqual(recorded.clips, project.clips)
            self.assertFalse((root / "clip-edited.txt").exists())
            self.assertEqual(media.read_bytes(), before)
            self.notified.assert_called_once()

    def test_the_caption_is_copied_only_when_asked_for(self) -> None:
        with TempMediaFolder() as root:
            _, project = self.project(root, copy_caption=True)
            (root / "clip.txt").write_text("A caption.", encoding="utf-8")

            state = wait_for(self.manager, self.manager.start(root, project, None).id)

            self.assertEqual(state.status, "completed", state.error)
            self.assertEqual((root / "clip-edited.txt").read_text(encoding="utf-8"), "A caption.")

    def test_repeated_exports_get_distinct_names_and_snapshots(self) -> None:
        with TempMediaFolder() as root:
            _, project = self.project(root)

            first = wait_for(self.manager, self.manager.start(root, project, None).id)
            second = wait_for(self.manager, self.manager.start(root, project, None).id)

            self.assertEqual(first.output_name, "clip-edited.mp4")
            self.assertEqual(second.output_name, "clip-edited-2.mp4")
            self.assertTrue(snapshot_path_for(root / "clip-edited-2.mp4").is_file())

    def test_the_export_renders_the_project_as_it_was_when_started(self) -> None:
        with TempMediaFolder() as root:
            _, project = self.project(root)
            state = self.manager.start(root, project, None)
            project.clips.clear()

            finished = wait_for(self.manager, state.id)

            recorded = VideoProject.model_validate_json(
                snapshot_path_for(Path(finished.output_path)).read_text(encoding="utf-8")
            )
            self.assertEqual(len(recorded.clips), 2)

    def test_a_changed_source_refuses_the_export(self) -> None:
        with TempMediaFolder() as root:
            media, project = self.project(root)
            media.write_bytes(media.read_bytes() + b"\0")

            with self.assertRaisesRegex(ValueError, "clip.mp4 is changed"):
                self.manager.start(root, project, None)

            self.assertEqual(sorted(p.name for p in root.iterdir()), ["clip.mp4"])

    def test_cancelling_leaves_no_output_snapshot_or_temp_file(self) -> None:
        with TempMediaFolder() as root:
            _, project = self.project(root)

            def wait_for_cancel(command, *, should_cancel, **_kwargs) -> None:
                Path(command[-1]).write_bytes(b"partial")
                while not should_cancel():
                    time.sleep(0.01)
                raise FfmpegCancelled

            with patch("video_project_export.run_ffmpeg", wait_for_cancel):
                state = self.manager.start(root, project, None)
                self.manager.cancel(state.id)
                finished = wait_for(self.manager, state.id)

            self.assertEqual(finished.status, "cancelled")
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["clip.mp4"])
            self.notified.assert_not_called()

    def test_a_failed_render_leaves_nothing_behind_and_says_why(self) -> None:
        with TempMediaFolder() as root:
            _, project = self.project(root)

            def fail(command, **_kwargs) -> None:
                Path(command[-1]).write_bytes(b"partial")
                raise RuntimeError("encoder exploded")

            with (
                patch("video_project_export.run_ffmpeg", fail),
                self.assertLogs("video_project_export", "WARNING"),
            ):
                finished = wait_for(self.manager, self.manager.start(root, project, None).id)

            self.assertEqual(finished.status, "failed")
            self.assertIn("encoder exploded", finished.error or "")
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["clip.mp4"])

    def test_a_publish_failure_takes_back_the_snapshot_and_caption(self) -> None:
        with TempMediaFolder() as root:
            _, project = self.project(root, copy_caption=True)
            (root / "clip.txt").write_text("A caption.", encoding="utf-8")

            with (
                patch("video_project_export.publish_new_file", side_effect=OSError("locked")),
                self.assertLogs("video_project_export", "WARNING"),
            ):
                finished = wait_for(self.manager, self.manager.start(root, project, None).id)

            self.assertEqual(finished.status, "failed")
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["clip.mp4", "clip.txt"])

    def test_a_leftover_temp_file_from_a_crash_is_swept(self) -> None:
        with TempMediaFolder() as root:
            _, project = self.project(root)
            leftover = root / f"old.mp4{VIDEO_PROJECT_EXPORT_TEMP_SUFFIX}"
            leftover.write_bytes(b"x")

            wait_for(self.manager, self.manager.start(root, project, None).id)

            self.assertFalse(leftover.exists())


class SnapshotFollowsItsVideoTests(unittest.TestCase):
    def export_with_snapshot(self, root: Path) -> tuple[Path, Path, Path]:
        source = write_image(root, "source.png")
        video = root / "source-edited.mp4"
        video.write_bytes(b"video")
        snapshot = snapshot_path_for(video)
        snapshot.write_text("{}", encoding="utf-8")
        return source, video, snapshot

    def test_deleting_the_video_deletes_its_snapshot_but_not_its_sources(self) -> None:
        with TempMediaFolder() as root:
            source, video, snapshot = self.export_with_snapshot(root)

            with patch("media_delete.delete_path", lambda path: path.unlink()):
                delete_media_with_sidecars(video)

            self.assertFalse(snapshot.exists())
            self.assertTrue(source.is_file())

    def test_moving_and_copying_the_video_carry_its_snapshot(self) -> None:
        for mode in ("move", "copy"):
            with self.subTest(mode=mode), TempMediaFolder() as root:
                source, video, snapshot = self.export_with_snapshot(root)
                destination = root / "elsewhere"
                destination.mkdir()

                transfer_media_batch(destination, [video], mode=mode)

                self.assertTrue((destination / snapshot.name).is_file())
                self.assertEqual(snapshot.exists(), mode == "copy")
                self.assertFalse((destination / source.name).exists())

    def test_renaming_the_video_renames_its_snapshot(self) -> None:
        with TempMediaFolder() as root:
            video = root / "source-edited.mp4"
            video.write_bytes(playable_video_bytes(duration=1))
            snapshot_path_for(video).write_text("{}", encoding="utf-8")

            run_rename_media_job(root, stem="trip")

            self.assertTrue((root / "trip_001.mp4.video-project.json").is_file())
            self.assertFalse(snapshot_path_for(video).exists())


if __name__ == "__main__":
    unittest.main()
