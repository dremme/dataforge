from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from pydantic import ValidationError

from ffmpeg_bin import ffmpeg_path
from schemas import VideoProject, VideoProjectClip, VideoProjectTitle, VideoProjectTransition
from testing_fixtures import TempMediaFolder, playable_video_bytes, write_image, write_wav
from video_project import (
    ProjectConflictError,
    allocate_draft_path,
    delete_draft,
    is_draft_file,
    is_snapshot_file,
    list_drafts,
    new_id,
    new_project_for_video,
    probe_source_file,
    read_project_file,
    save_project,
    serialize_project,
    snapshot_path_for,
    source_from_info,
    source_states,
    start_document,
)


def write_video(root: Path, name: str = "clip.mp4", *, audio: bool = True, seconds: float = 2):
    media = root / name
    media.write_bytes(playable_video_bytes(audio=audio, duration=seconds))
    return media


def title_clip(track_id: str, start: float, duration: float) -> VideoProjectClip:
    return VideoProjectClip(
        id=new_id(),
        track_id=track_id,
        kind="title",
        start=start,
        duration=duration,
        title=VideoProjectTitle(text="Hi"),
    )


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class NewProjectTests(unittest.TestCase):
    def test_the_video_starts_at_zero_on_v1_with_its_sound_linked_on_a1(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root, audio=True)

            project = new_project_for_video(media)

            self.assertEqual([t.name for t in project.tracks], ["V2", "V1", "A1", "A2"])
            video, audio = project.clips
            self.assertEqual((video.kind, video.track_id), ("video", project.tracks[1].id))
            self.assertEqual((audio.kind, audio.track_id), ("audio", project.tracks[2].id))
            self.assertEqual((video.start, audio.start), (0.0, 0.0))
            self.assertIsNotNone(video.link_id)
            self.assertEqual(video.link_id, audio.link_id)
            self.assertEqual(video.duration, audio.duration)
            self.assertEqual((project.width, project.height), (64, 48))
            self.assertEqual(project.frame_rate, 10.0)
            self.assertEqual(project.initial_source_id, project.sources[0].id)

    def test_a_silent_video_gets_no_audio_clip(self) -> None:
        with TempMediaFolder() as root:
            project = new_project_for_video(write_video(root, audio=False))

            self.assertEqual([clip.kind for clip in project.clips], ["video"])
            self.assertIsNone(project.clips[0].link_id)

    def test_the_live_file_is_used_even_when_a_quick_edit_backup_exists(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root, seconds=2)
            (root / "clip.mp4.bak").write_bytes(playable_video_bytes(duration=4))

            project = new_project_for_video(media)

            self.assertEqual(project.sources[0].name, "clip.mp4")
            self.assertAlmostEqual(project.clips[0].duration, 2.0, places=1)


class ProjectStructureTests(unittest.TestCase):
    def base(self, clips: list[VideoProjectClip], transitions=()) -> dict:
        return {
            "id": "p",
            "name": "Edit",
            "created_at": "now",
            "updated_at": "now",
            "width": 64,
            "height": 48,
            "frame_rate": 10,
            "tracks": [
                {"id": "v1", "kind": "video", "name": "V1"},
                {"id": "a1", "kind": "audio", "name": "A1"},
            ],
            "clips": [clip.model_dump() for clip in clips],
            "transitions": [t.model_dump() for t in transitions],
        }

    def test_two_overlapping_clips_on_one_track_are_refused(self) -> None:
        clips = [title_clip("v1", 0, 2), title_clip("v1", 1, 2)]

        with self.assertRaisesRegex(ValidationError, "overlap on V1"):
            VideoProject.model_validate(self.base(clips))

    def test_a_dissolve_makes_its_overlap_legal(self) -> None:
        first, second = title_clip("v1", 0, 2), title_clip("v1", 1.5, 2)
        dissolve = VideoProjectTransition(id="d", from_clip_id=first.id, to_clip_id=second.id)

        project = VideoProject.model_validate(self.base([first, second], [dissolve]))

        self.assertEqual(len(project.transitions), 1)

    def test_a_dissolve_without_an_overlap_is_refused(self) -> None:
        first, second = title_clip("v1", 0, 2), title_clip("v1", 2, 2)
        dissolve = VideoProjectTransition(id="d", from_clip_id=first.id, to_clip_id=second.id)

        with self.assertRaisesRegex(ValidationError, "overlap the end"):
            VideoProject.model_validate(self.base([first, second], [dissolve]))

    def test_a_title_cannot_sit_on_an_audio_track(self) -> None:
        with self.assertRaisesRegex(ValidationError, "title clip cannot sit on a audio track"):
            VideoProject.model_validate(self.base([title_clip("a1", 0, 1)]))

    def test_fades_longer_than_the_clip_are_refused(self) -> None:
        with self.assertRaisesRegex(ValidationError, "fades cannot be longer"):
            title_clip("v1", 0, 1).model_validate(
                {**title_clip("v1", 0, 1).model_dump(), "fade_in": 0.8, "fade_out": 0.5}
            )


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class SaveAndReopenTests(unittest.TestCase):
    def test_the_first_save_allocates_a_draft_and_later_saves_bump_the_revision(self) -> None:
        with TempMediaFolder() as root:
            project = new_project_for_video(write_video(root))

            path, saved = save_project(root, None, None, project)
            self.assertEqual(path.name, "clip-edit.video-project.json")
            self.assertEqual(saved.revision, 1)

            path_again, saved_again = save_project(root, path, 1, saved)
            self.assertEqual(path_again, path)
            self.assertEqual(saved_again.revision, 2)
            self.assertEqual(read_project_file(path).revision, 2)

    def test_a_save_from_a_stale_revision_is_refused(self) -> None:
        with TempMediaFolder() as root:
            project = new_project_for_video(write_video(root))
            path, saved = save_project(root, None, None, project)
            save_project(root, path, 1, saved)

            with self.assertRaises(ProjectConflictError):
                save_project(root, path, 1, saved)

            self.assertEqual(read_project_file(path).revision, 2)

    def test_a_second_draft_of_the_same_video_gets_a_numbered_name(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root)
            save_project(root, None, None, new_project_for_video(media))

            path, _ = save_project(root, None, None, new_project_for_video(media))

            self.assertEqual(path.name, "clip-edit-2.video-project.json")

    def test_snapshots_are_not_drafts_and_cannot_be_saved_over(self) -> None:
        with TempMediaFolder() as root:
            project = new_project_for_video(write_video(root))
            snapshot = root / "clip-edited.mp4.video-project.json"
            snapshot.write_text(serialize_project(project), encoding="utf-8")

            self.assertTrue(is_snapshot_file(snapshot))
            self.assertFalse(is_draft_file(snapshot))
            self.assertEqual(list_drafts(root), [])
            with self.assertRaisesRegex(ValueError, "export's record"):
                save_project(root, snapshot, 0, project)
            with self.assertRaisesRegex(ValueError, "export's record"):
                delete_draft(root, snapshot)

    def test_deleting_a_draft_leaves_its_sources(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root)
            path, _ = save_project(root, None, None, new_project_for_video(media))

            delete_draft(root, path)

            self.assertFalse(path.exists())
            self.assertTrue(media.is_file())

    def test_listing_reports_each_draft(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root)
            path, _ = save_project(root, None, None, new_project_for_video(media))

            (summary,) = list_drafts(root)

            self.assertEqual(summary.path, str(path))
            self.assertEqual(summary.initial_source_name, "clip.mp4")
            self.assertEqual(summary.initial_source_path, str(media))
            self.assertEqual(summary.clip_count, 2)

    def test_allocation_skips_taken_names(self) -> None:
        with TempMediaFolder() as root:
            (root / "clip-edit.video-project.json").write_text("{}", encoding="utf-8")

            self.assertEqual(
                allocate_draft_path(root, "clip").name, "clip-edit-2.video-project.json"
            )


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class SourceStateTests(unittest.TestCase):
    def test_missing_and_changed_sources_are_reported_by_name(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root)
            picture = write_image(root, "still.png")
            sound = write_wav(root, "music.wav")
            project = new_project_for_video(media)
            extra = [source_from_info(probe_source_file(p)) for p in (picture, sound)]
            project = project.model_copy(update={"sources": project.sources + extra})

            picture.unlink()
            stat = sound.stat()
            os.utime(sound, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))

            states = {s.source_id: s.state for s in source_states(root, project)}

            self.assertEqual(states[project.sources[0].id], "ok")
            self.assertEqual(states[extra[0].id], "missing")
            self.assertEqual(states[extra[1].id], "changed")

    def test_a_source_survives_a_round_trip_through_a_browser(self) -> None:
        """The editor holds the project in JavaScript, whose numbers are doubles."""
        with TempMediaFolder() as root:
            picture = write_image(root, "still.png")
            stat = picture.stat()
            os.utime(picture, ns=(stat.st_atime_ns, 1_791_000_000_123_456_789))
            project = new_project_for_video(write_video(root))
            project = project.model_copy(
                update={"sources": [*project.sources, source_from_info(probe_source_file(picture))]}
            )

            as_doubles = json.loads(serialize_project(project), parse_int=float)
            reloaded = VideoProject.model_validate(
                json.loads(json.dumps(as_doubles), parse_float=lambda text: int(float(text)))
            )

            self.assertEqual({s.state for s in source_states(root, reloaded)}, {"ok"})

    def test_sources_resolve_against_the_folder_they_are_moved_to(self) -> None:
        with TempMediaFolder() as root:
            first = root / "first"
            first.mkdir()
            project = new_project_for_video(write_video(first))
            moved = root / "moved"
            os.rename(first, moved)

            (status,) = source_states(moved, project)

            self.assertEqual(status.state, "ok")
            self.assertEqual(Path(status.path).parent, moved)


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class StartDocumentTests(unittest.TestCase):
    def test_a_plain_video_starts_an_unsaved_project(self) -> None:
        with TempMediaFolder() as root:
            document = start_document(write_video(root))

            self.assertIsNone(document.path)
            self.assertIsNone(document.opened_from_export)
            self.assertEqual(document.sources[0].state, "ok")

    def test_an_exported_video_reopens_its_recorded_edit_as_a_fresh_draft(self) -> None:
        with TempMediaFolder() as root:
            recorded = new_project_for_video(write_video(root)).model_copy(
                update={"name": "Recorded", "revision": 7}
            )
            export = write_video(root, "clip-edited.mp4")
            snapshot = snapshot_path_for(export)
            snapshot.write_text(serialize_project(recorded), encoding="utf-8")
            before = snapshot.read_bytes()

            document = start_document(export)

            self.assertIsNone(document.path)
            self.assertEqual(document.opened_from_export, str(export))
            self.assertEqual(document.project.name, "Recorded")
            self.assertEqual(document.project.revision, 0)
            self.assertNotEqual(document.project.id, recorded.id)
            self.assertEqual(json.loads(snapshot.read_bytes()), json.loads(before))


if __name__ == "__main__":
    unittest.main()
