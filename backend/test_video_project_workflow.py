"""Representative checks for the editor's target workflow: 1080p, 24 fps generated media.

They render with the real ffmpeg and read frames back, so one-frame placements, source-in
alignment, the export's own frame renderer, audio protection and save/reopen are verified on the
delivered file rather than on the graph text.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import time
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from testing_fixtures import isolate_test_database

isolate_test_database()

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from constants import (
    VIDEO_PROJECT_LOUDNESS_TARGET_LUFS,
    VIDEO_PROJECT_MAX_CHECKPOINTS,
    VIDEO_PROJECT_TRUE_PEAK_CEILING_DB,
)
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import run_ffmpeg
from routes import router
from schemas import (
    ColorAdjust,
    VideoProject,
    VideoProjectClip,
    VideoProjectExportSettings,
    VideoProjectExportState,
    VideoProjectTitle,
    VideoProjectTrack,
    VideoProjectTransform,
    VideoProjectTransition,
)
from testing_fixtures import TempMediaFolder
from video_edit import StreamColor
from video_project import probe_source_file, source_from_info
from video_project_compat import make_compatible_copy
from video_project_export import ExportManager
from video_project_render import (
    build_file_measure,
    build_frame,
    build_mix_measure,
    build_render,
    parse_loudness,
)
from video_project_versions import (
    delete_project_versions,
    list_versions,
    read_version,
    record_checkpoint,
    save_named_version,
)

RATE = 24
FRAME = 1 / RATE
RED = (255, 0, 0)
YELLOW = (255, 255, 0)
BLUE = (0, 0, 255)
GREEN = (0, 255, 0)
BLACK = (0, 0, 0)
#: AAC can overshoot a true-peak limiter slightly; well under what a clipping mix measures.
CODEC_OVERSHOOT_DB = 0.5


def ffmpeg() -> str:
    executable = ffmpeg_path()
    assert executable
    return executable


def generate(root: Path, name: str, *arguments: str) -> Path:
    media = root / name
    subprocess.run(
        [ffmpeg(), "-v", "error", "-y", *arguments, str(media)], check=True, capture_output=True
    )
    return media


def write_shot(root: Path, name: str = "shot.mp4", *, codec: str = "libx264") -> Path:
    """Two seconds at 1080p/24: frames 0-23 red, 24-47 yellow, with a tone throughout."""
    return generate(
        root,
        name,
        *("-f", "lavfi", "-i", f"color=c=red:s=1920x1080:r={RATE}:d=1"),
        *("-f", "lavfi", "-i", f"color=c=yellow:s=1920x1080:r={RATE}:d=1"),
        *("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"),
        *("-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a"),
        *("-c:v", codec, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"),
    )


def write_still(root: Path, name: str, color: tuple[int, int, int]) -> Path:
    media = root / name
    Image.new("RGB", (1920, 1080), color).save(media)
    return media


def write_tone(root: Path, name: str, amplitude: float, seconds: float = 2.0) -> Path:
    return generate(
        root,
        name,
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={amplitude}*sin(2*PI*997*t)|{amplitude}*sin(2*PI*997*t):s=48000:d={seconds}",
    )


def frames_of(video: Path) -> list[tuple[int, int, int]]:
    """The centre colour of every decoded frame, in order."""
    result = subprocess.run(
        [
            *(ffmpeg(), "-v", "error", "-i", str(video), "-fps_mode", "passthrough"),
            *("-vf", "scale=16:9", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"),
        ],
        capture_output=True,
        check=True,
    )
    size = 16 * 9 * 3
    centre = (4 * 16 + 8) * 3
    data = result.stdout
    return [
        (data[offset + centre], data[offset + centre + 1], data[offset + centre + 2])
        for offset in range(0, len(data) - size + 1, size)
    ]


def stream_info(video: Path) -> str:
    return subprocess.run([ffmpeg(), "-i", str(video)], capture_output=True, text=True).stderr


def close(actual: tuple[int, int, int], expected: tuple[int, int, int], tolerance=40) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(actual, expected, strict=True))


def clip(clip_id: str, track: str, kind: str, start_frame: int, frames: int, **fields):
    return VideoProjectClip(
        id=clip_id,
        track_id=track,
        kind=kind,
        start=start_frame * FRAME,
        duration=frames * FRAME,
        **fields,
    )


def tracks() -> list[VideoProjectTrack]:
    return [
        VideoProjectTrack(id="v2", kind="video", name="V2"),
        VideoProjectTrack(id="v1", kind="video", name="V1"),
        VideoProjectTrack(id="a1", kind="audio", name="A1"),
        VideoProjectTrack(id="a2", kind="audio", name="A2"),
    ]


def project(root: Path, names: list[str], clips: list[VideoProjectClip], **fields) -> VideoProject:
    defaults = {
        "id": "workflow",
        "name": "Workflow",
        "created_at": "now",
        "updated_at": "now",
        "width": 1920,
        "height": 1080,
        "frame_rate": RATE,
        "sources": [source_from_info(probe_source_file(root / name), name) for name in names],
        "tracks": tracks(),
        "clips": clips,
    }
    return VideoProject(**{**defaults, **fields})


def placement_project(root: Path) -> VideoProject:
    """Frames 0-23 the red half of the shot; 24 one blue frame; 25 the shot's last red frame
    (source-in 23/24); 26 a green one-frame overlay above yellow; 27 yellow."""
    write_shot(root)
    write_still(root, "blue.png", BLUE)
    write_still(root, "green.png", GREEN)
    return project(
        root,
        ["shot.mp4", "blue.png", "green.png"],
        [
            clip("a", "v1", "video", 0, 24, source_id="shot.mp4", link_id="l1"),
            clip("a-sound", "a1", "audio", 0, 24, source_id="shot.mp4", link_id="l1"),
            clip("b", "v1", "image", 24, 1, source_id="blue.png"),
            clip("c", "v1", "video", 25, 3, source_id="shot.mp4", source_in=23 * FRAME),
            clip("d", "v2", "image", 26, 1, source_id="green.png"),
        ],
    )


EXPECTED = [RED] * 24 + [BLUE, RED, GREEN, YELLOW]


def wait_for(manager: ExportManager, export_id: str) -> VideoProjectExportState:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        state = next(s for s in manager.list_exports() if s.id == export_id)
        if state.status != "running":
            return state
        time.sleep(0.05)
    raise AssertionError("export did not finish")


def render_small(root: Path, edit: VideoProject, **settings) -> Path:
    """Renders, measuring the mix first when the settings normalize, as an export does."""
    output = root / "out.mp4"
    chosen = VideoProjectExportSettings(**settings)
    with tempfile.TemporaryDirectory() as workspace:
        measured = None
        if chosen.audio_level == "normalize":
            log = run_ffmpeg(
                build_mix_measure(edit, root, executable=ffmpeg(), workspace=Path(workspace)),
                cwd=Path(workspace),
            )
            loudness = parse_loudness(log)
            assert loudness is not None
            measured = loudness.integrated_lufs
        plan = build_render(
            edit,
            root,
            output,
            settings=chosen,
            executable=ffmpeg(),
            workspace=Path(workspace),
            probe_color=lambda _path: StreamColor(),
            measured_lufs=measured,
        )
        run_ffmpeg(plan.command, cwd=Path(workspace))
    return output


def measure(media: Path):
    loudness = parse_loudness(run_ffmpeg(build_file_measure(ffmpeg(), media)))
    assert loudness is not None
    return loudness


class FramePlacementTests(unittest.TestCase):
    def test_a_1080p_24_fps_export_places_every_frame_where_the_timeline_does(self) -> None:
        with TempMediaFolder() as root:
            edit = placement_project(root)
            manager = ExportManager()
            started = manager.start(root, edit, None)
            state = wait_for(manager, started.id)
            self.assertEqual(state.status, "completed", state.error)

            video = Path(state.output_path)
            info = stream_info(video)
            self.assertRegex(info, r"Video: h264.*1920x1080")
            self.assertRegex(info, r"\b24 fps\b")
            self.assertRegex(info, r"Audio: aac.*48000 Hz, stereo")

            frames = frames_of(video)
            self.assertEqual(len(frames), len(EXPECTED))
            for index, (actual, expected) in enumerate(zip(frames, EXPECTED, strict=True)):
                self.assertTrue(close(actual, expected), f"frame {index}: {actual} != {expected}")
            # The linked tone ends with its clip at frame 24 and the export reports its level.
            self.assertIsNotNone(state.loudness_lufs)
            self.assertIsNotNone(state.true_peak_db)

    def test_the_frame_renderer_draws_what_the_export_shows_at_full_size(self) -> None:
        with TempMediaFolder() as root:
            edit = placement_project(root)
            for index in (0, 23, 24, 25, 26, 27):
                with self.subTest(frame=index), tempfile.TemporaryDirectory() as workspace:
                    output = Path(workspace) / "frame.png"
                    command = build_frame(
                        edit,
                        root,
                        output,
                        # Anywhere inside the frame draws that frame.
                        (index + 0.7) * FRAME,
                        executable=ffmpeg(),
                        workspace=Path(workspace),
                        probe_color=lambda _path: StreamColor(),
                    )
                    run_ffmpeg(command, cwd=Path(workspace))
                    with Image.open(output) as picture:
                        self.assertEqual(picture.size, (1920, 1080))
                        actual = picture.convert("RGB").getpixel((960, 540))
                    self.assertTrue(close(actual, EXPECTED[index]), f"{actual}")

    def test_a_frame_in_a_gap_is_black_and_a_missing_source_is_named(self) -> None:
        with TempMediaFolder() as root:
            write_still(root, "blue.png", BLUE)
            edit = project(
                root, ["blue.png"], [clip("b", "v1", "image", 10, 2, source_id="blue.png")]
            )
            with tempfile.TemporaryDirectory() as workspace:
                output = Path(workspace) / "frame.png"
                command = build_frame(
                    edit,
                    root,
                    output,
                    3 * FRAME,
                    executable=ffmpeg(),
                    workspace=Path(workspace),
                    probe_color=lambda _path: StreamColor(),
                )
                run_ffmpeg(command, cwd=Path(workspace))
                with Image.open(output) as picture:
                    self.assertEqual(picture.convert("RGB").getpixel((960, 540)), BLACK)

            (root / "blue.png").unlink()
            with (
                tempfile.TemporaryDirectory() as workspace,
                self.assertRaises(ValueError) as caught,
            ):
                build_frame(
                    edit,
                    root,
                    Path(workspace) / "frame.png",
                    10 * FRAME,
                    executable=ffmpeg(),
                    workspace=Path(workspace),
                    probe_color=lambda _path: StreamColor(),
                )
            self.assertIn("blue.png is missing", str(caught.exception))


class AudioProtectionTests(unittest.TestCase):
    def loud_mix(self, root: Path) -> VideoProject:
        """Two in-phase tones at 0.9 each sum to about +5 dBFS."""
        write_tone(root, "one.wav", 0.9)
        write_tone(root, "two.wav", 0.9)
        return project(
            root,
            ["one.wav", "two.wav"],
            [
                VideoProjectClip(
                    id="spacer",
                    track_id="v1",
                    kind="title",
                    start=0,
                    duration=2,
                    title=VideoProjectTitle(text=""),
                ),
                VideoProjectClip(
                    id="one", track_id="a1", kind="audio", source_id="one.wav", start=0, duration=2
                ),
                VideoProjectClip(
                    id="two", track_id="a2", kind="audio", source_id="two.wav", start=0, duration=2
                ),
            ],
            width=64,
            height=48,
        )

    def test_an_unprotected_mix_clips_and_the_limiter_holds_the_ceiling(self) -> None:
        with TempMediaFolder() as root:
            edit = self.loud_mix(root)
            self.assertGreater(
                measure(render_small(root, edit, audio_level="unchanged")).true_peak_db, 3
            )
            limited = measure(render_small(root, edit, audio_level="limit"))
            self.assertLessEqual(
                limited.true_peak_db, VIDEO_PROJECT_TRUE_PEAK_CEILING_DB + CODEC_OVERSHOOT_DB
            )

    def test_normalizing_brings_a_quiet_mix_to_the_target_under_the_ceiling(self) -> None:
        with TempMediaFolder() as root:
            write_tone(root, "quiet.wav", 0.05)
            edit = self.loud_mix(root)
            edit = edit.model_copy(
                update={
                    "sources": [
                        *edit.sources,
                        source_from_info(probe_source_file(root / "quiet.wav"), "quiet.wav"),
                    ],
                    "clips": [
                        edit.clips[0],
                        VideoProjectClip(
                            id="quiet",
                            track_id="a1",
                            kind="audio",
                            source_id="quiet.wav",
                            start=0,
                            duration=2,
                        ),
                    ],
                }
            )
            before = measure(render_small(root, edit, audio_level="unchanged"))
            self.assertLess(before.integrated_lufs, VIDEO_PROJECT_LOUDNESS_TARGET_LUFS - 6)
            after = measure(render_small(root, edit, audio_level="normalize"))
            self.assertAlmostEqual(
                after.integrated_lufs, VIDEO_PROJECT_LOUDNESS_TARGET_LUFS, delta=1
            )
            self.assertLessEqual(
                after.true_peak_db, VIDEO_PROJECT_TRUE_PEAK_CEILING_DB + CODEC_OVERSHOOT_DB
            )

    def test_an_export_that_normalizes_measures_first_and_reports_the_result(self) -> None:
        with TempMediaFolder() as root:
            edit = self.loud_mix(root)
            edit = edit.model_copy(
                update={"export": VideoProjectExportSettings(audio_level="normalize")}
            )
            manager = ExportManager()
            state = wait_for(manager, manager.start(root, edit, None).id)
            self.assertEqual(state.status, "completed", state.error)
            assert state.loudness_lufs is not None and state.true_peak_db is not None
            self.assertAlmostEqual(state.loudness_lufs, VIDEO_PROJECT_LOUDNESS_TARGET_LUFS, delta=1)
            self.assertLessEqual(
                state.true_peak_db, VIDEO_PROJECT_TRUE_PEAK_CEILING_DB + CODEC_OVERSHOOT_DB
            )

    def test_a_silent_export_reports_no_loudness(self) -> None:
        self.assertIsNone(parse_loudness("no summary here"))
        log = (
            "Integrated loudness:\n    I:         -inf LUFS\nTrue peak:\n    Peak:       -inf dBFS"
        )
        loudness = parse_loudness(log)
        assert loudness is not None
        self.assertEqual(loudness.integrated_lufs, float("-inf"))


class CompatibleCopyTests(unittest.TestCase):
    def test_an_mpeg4_part_2_source_is_copied_as_h264_with_the_same_frames(self) -> None:
        with TempMediaFolder() as root:
            original = write_shot(root, "generated.mp4", codec="mpeg4")
            self.assertRegex(stream_info(original), r"Video: mpeg4")

            copy = make_compatible_copy(ffmpeg(), original)

            self.assertEqual(copy.name, "generated-h264.mp4")
            self.assertRegex(stream_info(copy), r"Video: h264.*1920x1080")
            frames = frames_of(copy)
            self.assertEqual(len(frames), 48)
            self.assertTrue(close(frames[23], RED) and close(frames[24], YELLOW))
            self.assertTrue(original.is_file())
            # A second copy never replaces the first.
            self.assertEqual(make_compatible_copy(ffmpeg(), original).name, "generated-h264-2.mp4")
            self.assertEqual(sorted(p.name for p in root.iterdir() if "tmp" in p.name), [])


class VersionTests(unittest.TestCase):
    def setUp(self) -> None:
        delete_project_versions("versioned")

    def edit(self, revision: int, name: str = "Edit") -> VideoProject:
        return VideoProject(
            id="versioned",
            name=name,
            revision=revision,
            created_at="now",
            updated_at="now",
            width=64,
            height=48,
            frame_rate=RATE,
            tracks=tracks(),
        )

    def test_checkpoints_are_spaced_out_and_only_the_newest_are_kept(self) -> None:
        start = datetime(2026, 1, 1, tzinfo=UTC)
        self.assertTrue(record_checkpoint(self.edit(1), now=start))
        self.assertFalse(record_checkpoint(self.edit(2), now=start + timedelta(minutes=3)))
        named = save_named_version(self.edit(2, "Before the music"), "Before the music")

        for index in range(VIDEO_PROJECT_MAX_CHECKPOINTS + 5):
            record_checkpoint(self.edit(10 + index), now=start + timedelta(hours=1 + index))

        versions = list_versions("versioned")
        automatic = [version for version in versions if version.label is None]
        self.assertEqual(len(automatic), VIDEO_PROJECT_MAX_CHECKPOINTS)
        self.assertEqual(automatic[0].revision, 10 + VIDEO_PROJECT_MAX_CHECKPOINTS + 4)
        self.assertIn(named.id, [version.id for version in versions])
        restored = read_version(named.id)
        assert restored is not None
        self.assertEqual(restored.name, "Before the music")


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app, base_url="http://127.0.0.1:8000")


class SaveAndReopenTests(unittest.TestCase):
    def representative(self, root: Path) -> VideoProject:
        """Every clip kind, a dissolve with linked sound, a grade, a crop, a transform, a
        retimed clip and a title, at 1080p/24."""
        edit = placement_project(root)
        clips = [
            clip("a", "v1", "video", 0, 24, source_id="shot.mp4", link_id="l1"),
            clip("a-sound", "a1", "audio", 0, 24, source_id="shot.mp4", link_id="l1"),
            clip(
                "c", "v1", "video", 18, 24, source_id="shot.mp4", link_id="l2",
                adjust=ColorAdjust(exposure=0.2), speed=0.5,
            ),
            clip("c-sound", "a1", "audio", 18, 24, source_id="shot.mp4", link_id="l2", speed=0.5),
            clip(
                "d", "v2", "image", 0, 48, source_id="green.png",
                transform=VideoProjectTransform(x=0.25, scale=0.5, opacity=0.8),
                crop={"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5},
            ),
            clip("t", "v2", "title", 48, 24, title=VideoProjectTitle(text="The end")),
        ]  # fmt: skip
        return edit.model_copy(
            update={
                "clips": clips,
                "transitions": [VideoProjectTransition(id="x", from_clip_id="a", to_clip_id="c")],
            }
        )

    def test_a_saved_project_reopens_as_saved_with_a_checkpoint_and_versions_go_with_it(
        self,
    ) -> None:
        with TempMediaFolder() as root:
            edit = VideoProject.model_validate(self.representative(root).model_dump())
            api = client()
            saved = api.put(
                "/api/video-projects/project",
                json={"folder": str(root), "path": None, "project": edit.model_dump(mode="json")},
            )
            self.assertEqual(saved.status_code, 200, saved.text)
            path = saved.json()["path"]

            reopened = api.get("/api/video-projects/project", params={"path": path}).json()
            again = VideoProject.model_validate(reopened["project"])
            self.assertEqual(
                again.model_dump(exclude={"revision", "updated_at"}),
                edit.model_dump(exclude={"revision", "updated_at"}),
            )
            self.assertTrue(all(status["state"] == "ok" for status in reopened["sources"]))

            versions = api.get("/api/video-projects/versions", params={"project_id": edit.id})
            self.assertEqual([v["revision"] for v in versions.json()["versions"]], [1])
            named = api.post(
                "/api/video-projects/versions",
                json={"project": again.model_dump(mode="json"), "label": "Rough cut"},
            ).json()
            restored = api.get(
                f"/api/video-projects/versions/{named['id']}", params={"folder": str(root)}
            ).json()
            self.assertEqual(VideoProject.model_validate(restored["project"]), again)
            self.assertEqual(len(restored["sources"]), len(again.sources))

            self.assertEqual(
                api.delete("/api/video-projects/project", params={"path": path}).status_code, 204
            )
            self.assertEqual(list_versions(edit.id), [])

    def test_the_representative_project_exports_at_1080p_24(self) -> None:
        with TempMediaFolder() as root:
            edit = self.representative(root)
            manager = ExportManager()
            state = wait_for(manager, manager.start(root, edit, None).id)
            self.assertEqual(state.status, "completed", state.error)
            frames = frames_of(Path(state.output_path))
            self.assertEqual(len(frames), 72)
            match = re.search(r"Duration: 00:00:0(\d\.\d+)", stream_info(Path(state.output_path)))
            assert match
            self.assertAlmostEqual(float(match.group(1)), 3.0, delta=0.05)


if __name__ == "__main__":
    unittest.main()
