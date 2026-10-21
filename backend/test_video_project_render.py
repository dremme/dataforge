from __future__ import annotations

import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import ImageFont

from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import run_ffmpeg
from schemas import (
    AudioEffects,
    VideoProject,
    VideoProjectClip,
    VideoProjectExportSettings,
    VideoProjectExportSpan,
    VideoProjectFont,
    VideoProjectTitle,
    VideoProjectTrack,
    VideoProjectTransform,
    VideoProjectTransition,
)
from system_fonts import FontFace
from testing_fixtures import TempMediaFolder, write_image, write_wav
from video_edit import StreamColor
from video_project import new_id, probe_source_file, source_from_info
from video_project_render import (
    GRAPH_FILE_NAME,
    audible_tracks,
    build_render,
    export_size,
    render_title_image,
    render_window,
)

RED = (220, 30, 30)
BLUE = (30, 30, 220)
GREEN = (30, 200, 30)


def project_with(
    root: Path,
    clips: list[VideoProjectClip],
    *,
    sources=(),
    tracks: list[VideoProjectTrack] | None = None,
    transitions=(),
) -> VideoProject:
    return VideoProject(
        id="p",
        name="Edit",
        created_at="now",
        updated_at="now",
        width=64,
        height=48,
        frame_rate=10,
        sources=[source_from_info(probe_source_file(root / name), name) for name in sources],
        tracks=tracks
        or [
            VideoProjectTrack(id="v2", kind="video", name="V2"),
            VideoProjectTrack(id="v1", kind="video", name="V1"),
            VideoProjectTrack(id="a1", kind="audio", name="A1"),
        ],
        clips=clips,
        transitions=list(transitions),
    )


def still(source: str, track: str, start: float, duration: float, **fields) -> VideoProjectClip:
    return VideoProjectClip(
        id=new_id(),
        track_id=track,
        kind="image",
        source_id=source,
        start=start,
        duration=duration,
        **fields,
    )


def spacer(duration: float) -> VideoProjectClip:
    """An empty title: a transparent layer that sets the timeline's length."""
    return VideoProjectClip(
        id=new_id(),
        track_id="v2",
        kind="title",
        start=0,
        duration=duration,
        title=VideoProjectTitle(text=""),
    )


def render(
    root: Path, project: VideoProject, span: VideoProjectExportSpan | None = None, **settings
) -> Path:
    executable = ffmpeg_path()
    assert executable
    output = root / "out.mp4"
    with tempfile.TemporaryDirectory() as workspace:
        plan = build_render(
            project,
            root,
            output,
            settings=VideoProjectExportSettings(**settings),
            executable=executable,
            workspace=Path(workspace),
            probe_color=lambda _path: StreamColor(),
            span=span,
        )
        run_ffmpeg(plan.command, cwd=Path(workspace))
    return output


def pixel(
    video: Path, seconds: float, x: int = 32, y: int = 24, *, width: int = 64
) -> tuple[int, int, int]:
    executable = ffmpeg_path()
    assert executable
    result = subprocess.run(
        [
            *(executable, "-v", "error", "-ss", f"{seconds}", "-i", str(video)),
            *("-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"),
        ],
        capture_output=True,
        check=True,
    )
    offset = (y * width + x) * 3
    data = result.stdout
    return data[offset], data[offset + 1], data[offset + 2]


def loudness(media: Path, start: float, seconds: float) -> float:
    executable = ffmpeg_path()
    assert executable
    result = subprocess.run(
        [
            *(executable, "-v", "info", "-ss", f"{start}", "-t", f"{seconds}", "-i", str(media)),
            *("-af", "volumedetect", "-vn", "-f", "null", "-"),
        ],
        capture_output=True,
        check=True,
        text=True,
    )
    match = re.search(r"max_volume: (-?[\d.]+|-inf) dB", result.stderr)
    assert match, result.stderr
    return float("-inf") if match.group(1) == "-inf" else float(match.group(1))


def close(actual: tuple[int, int, int], expected: tuple[int, int, int], tolerance=40) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(actual, expected, strict=True))


class ExportSizeTests(unittest.TestCase):
    def project(self, width: int, height: int) -> VideoProject:
        return VideoProject(
            id="p",
            name="E",
            created_at="n",
            updated_at="n",
            width=width,
            height=height,
            frame_rate=30,
            tracks=[VideoProjectTrack(id="v", kind="video", name="V1")],
        )

    def test_source_size_keeps_the_project_frame(self) -> None:
        size = export_size(self.project(1280, 720), VideoProjectExportSettings())
        self.assertEqual(size, (1280, 720))

    def test_orientation_swaps_or_squares_the_source_sides(self) -> None:
        project = self.project(1280, 720)
        portrait = VideoProjectExportSettings(orientation="portrait")
        square = VideoProjectExportSettings(orientation="square")

        self.assertEqual(export_size(project, portrait), (720, 1280))
        self.assertEqual(export_size(project, square), (720, 720))

    def test_presets_fix_the_short_side_and_keep_the_project_aspect(self) -> None:
        self.assertEqual(
            export_size(self.project(640, 480), VideoProjectExportSettings(size="1080p")),
            (1440, 1080),
        )
        self.assertEqual(
            export_size(self.project(1080, 1350), VideoProjectExportSettings(size="1080p")),
            (1080, 1350),
        )
        self.assertEqual(
            export_size(self.project(2582, 1080), VideoProjectExportSettings(size="2160p")),
            (5164, 2160),
        )

    def test_a_preset_in_another_orientation_swaps_the_project_sides(self) -> None:
        settings = VideoProjectExportSettings(size="720p", orientation="portrait")

        self.assertEqual(export_size(self.project(1920, 1080), settings), (720, 1280))


class AudibleTrackTests(unittest.TestCase):
    def test_solo_silences_the_rest_and_mute_beats_solo(self) -> None:
        tracks = [
            VideoProjectTrack(id="a1", kind="audio", name="A1", solo=True),
            VideoProjectTrack(id="a2", kind="audio", name="A2"),
            VideoProjectTrack(id="a3", kind="audio", name="A3", solo=True, muted=True),
        ]
        project = VideoProject(
            id="p", name="E", created_at="n", updated_at="n", width=64, height=48,
            frame_rate=10, tracks=tracks,
        )  # fmt: skip

        self.assertEqual([t.id for t in audible_tracks(project)], ["a1"])


class SoundEffectTests(unittest.TestCase):
    def sounding(self, root: Path, **effects: float) -> VideoProject:
        write_wav(root, "tone.wav", seconds=2)
        sound = VideoProjectClip(
            id="sound", track_id="a1", kind="audio", source_id="tone.wav", start=0, duration=1,
            audio_effects=AudioEffects(**effects),
        )  # fmt: skip
        return project_with(root, [spacer(1), sound], sources=["tone.wav"])

    def graph(self, root: Path, project: VideoProject, sound_source=None) -> tuple[str, list[str]]:
        with tempfile.TemporaryDirectory() as workspace:
            plan = build_render(
                project,
                root,
                root / "out.mp4",
                settings=VideoProjectExportSettings(),
                executable="ffmpeg",
                workspace=Path(workspace),
                probe_color=lambda _path: StreamColor(),
                **({"sound_source": sound_source} if sound_source else {}),
            )
            return (Path(workspace) / GRAPH_FILE_NAME).read_text(encoding="utf-8"), plan.command

    def test_a_clip_is_shaped_after_its_retime_and_before_its_gain(self) -> None:
        with TempMediaFolder() as root:
            graph, _ = self.graph(root, self.sounding(root, low_cut=120, treble=4))

        chain = next(line for line in graph.split(";\n") if line.endswith("[aud0]"))
        self.assertLess(chain.index("atrim=duration"), chain.index("highpass=f=120"))
        self.assertLess(chain.index("highpass"), chain.index("highshelf=g=4"))

    def test_noise_reduction_reads_the_sound_from_its_source(self) -> None:
        """The export hands in the proxy the preview played; the plan only reads what it is given."""
        with TempMediaFolder() as root:
            proxy = root / "proxy.flac"
            asked: list[tuple[Path, float]] = []

            def sound(path: Path, clip: VideoProjectClip) -> Path:
                asked.append((path, clip.audio_effects.noise_reduction))
                return proxy

            _, command = self.graph(root, self.sounding(root, noise_reduction=0.5), sound)

        self.assertEqual(asked, [(root / "tone.wav", 0.5)])
        self.assertIn(str(proxy), command)
        self.assertNotIn(str(root / "tone.wav"), command)

    def test_only_sound_clips_carry_sound_effects(self) -> None:
        with self.assertRaisesRegex(ValueError, "Only sound clips"):
            VideoProjectClip(
                id="t", track_id="v1", kind="title", start=0, duration=1,
                title=VideoProjectTitle(text="Hi"), audio_effects=AudioEffects(bass=3),
            )  # fmt: skip


class TitleImageTests(unittest.TestCase):
    def test_the_text_lands_on_its_anchor_and_the_rest_stays_clear(self) -> None:
        title = VideoProjectTitle(text="HELLO", size=0.2, x=0.25, y=0.5, color="#ff0000")

        image = render_title_image(title, 400, 200)

        alpha = image.getchannel("A")
        left, top, right, bottom = alpha.getbbox() or (0, 0, 0, 0)
        self.assertAlmostEqual((left + right) / 2, 100, delta=8)
        self.assertAlmostEqual((top + bottom) / 2, 100, delta=8)
        self.assertEqual(image.getpixel((390, 10))[3], 0)

    def test_a_chosen_font_is_loaded_from_its_installed_face(self) -> None:
        face = FontFace(family="Display", style="Bold", path=Path("display.ttc"), index=2)
        chosen = VideoProjectFont(family="Display", style="Bold")
        loads: list[tuple[str, int]] = []
        real_truetype = ImageFont.truetype

        # Pillow's built-in default font is itself a truetype load, from memory.
        def truetype(path, size: int, index: int = 0, **options):
            if not isinstance(path, str):
                return real_truetype(path, size, index=index, **options)
            loads.append((Path(path).name, index))
            return ImageFont.load_default(size=size)

        with (
            patch("video_project_render.find_face", return_value=face) as find,
            patch("video_project_render.ImageFont.truetype", side_effect=truetype),
        ):
            render_title_image(VideoProjectTitle(text="Hi", font=chosen), 64, 48)

        find.assert_called_once_with("Display", "Bold")
        self.assertEqual(loads[0], ("display.ttc", 2))

    def test_a_font_this_machine_lacks_draws_like_the_default(self) -> None:
        missing = VideoProjectFont(family="Not Installed Anywhere", style="Regular")

        with patch("video_project_render.find_face", return_value=None):
            chosen = render_title_image(VideoProjectTitle(text="Hi", font=missing), 120, 60)
        default = render_title_image(VideoProjectTitle(text="Hi"), 120, 60)

        self.assertEqual(chosen.tobytes(), default.tobytes())

    def test_an_empty_title_is_fully_transparent(self) -> None:
        image = render_title_image(VideoProjectTitle(text="  "), 64, 48)

        self.assertIsNone(image.getchannel("A").getbbox())


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class CompositeTests(unittest.TestCase):
    def test_a_clip_shows_only_between_its_start_and_end_and_gaps_are_black(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            project = project_with(
                root, [spacer(3), still("red.png", "v1", 1.0, 1.0)], sources=["red.png"]
            )

            video = render(root, project)

            self.assertTrue(close(pixel(video, 0.5), (0, 0, 0)))
            self.assertTrue(close(pixel(video, 1.5), RED))
            self.assertTrue(close(pixel(video, 2.5), (0, 0, 0)))

    def test_the_background_fills_gaps_and_the_padding_of_a_fitted_export(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            project = project_with(
                root, [spacer(2), still("red.png", "v1", 1.0, 1.0)], sources=["red.png"]
            ).model_copy(update={"background": "#1e1edc"})

            video = render(root, project, orientation="square")

            self.assertTrue(close(pixel(video, 0.5, 24, 24, width=48), BLUE))
            self.assertTrue(close(pixel(video, 1.5, 24, 24, width=48), RED))
            self.assertTrue(close(pixel(video, 1.5, 24, 2, width=48), BLUE))

    def test_a_project_saved_without_a_background_draws_on_black(self) -> None:
        with TempMediaFolder() as root:
            fields = project_with(root, [spacer(1)]).model_dump(exclude={"background"})

            self.assertEqual(VideoProject.model_validate(fields).background, "#000000")

    def test_higher_tracks_composite_above_lower_ones_unless_hidden(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            write_image(root, "green.png", color=GREEN)
            clips = [
                still("red.png", "v1", 0, 1),
                still("green.png", "v2", 0, 1, transform=VideoProjectTransform(scale=0.5)),
            ]
            project = project_with(root, clips, sources=["red.png", "green.png"])

            video = render(root, project)
            self.assertTrue(close(pixel(video, 0.5), GREEN))
            self.assertTrue(close(pixel(video, 0.5, 2, 2), RED))

            hidden = project.model_copy(
                update={
                    "tracks": [
                        track.model_copy(update={"hidden": track.id == "v2"})
                        for track in project.tracks
                    ]
                }
            )
            self.assertTrue(close(pixel(render(root, hidden), 0.5), RED))

    def test_a_dissolve_blends_the_two_clips_across_their_overlap(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            write_image(root, "blue.png", color=BLUE)
            first = still("red.png", "v1", 0, 2)
            second = still("blue.png", "v1", 1, 2)
            dissolve = VideoProjectTransition(id="d", from_clip_id=first.id, to_clip_id=second.id)
            project = project_with(
                root, [first, second], sources=["red.png", "blue.png"], transitions=[dissolve]
            )

            video = render(root, project)

            self.assertTrue(close(pixel(video, 0.5), RED))
            middle = pixel(video, 1.5)
            self.assertTrue(80 < middle[0] < 180 and 80 < middle[2] < 180, middle)
            self.assertTrue(close(pixel(video, 2.5), BLUE))

    def test_a_different_export_frame_letterboxes_without_stretching(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            project = project_with(root, [still("red.png", "v1", 0, 1)], sources=["red.png"])

            video = render(root, project, orientation="square")

            probe = subprocess.run(
                [ffmpeg_path() or "", "-i", str(video)], capture_output=True, text=True
            ).stderr
            self.assertIn("48x48", probe)

    def test_audio_plays_only_where_it_is_placed_and_a_muted_track_is_silent(self) -> None:
        with TempMediaFolder() as root:
            write_wav(root, "tone.wav", seconds=2)
            sound = VideoProjectClip(
                id=new_id(), track_id="a1", kind="audio", source_id="tone.wav", start=1.0,
                duration=1.0,
            )  # fmt: skip
            project = project_with(root, [spacer(3), sound], sources=["tone.wav"])

            video = render(root, project)
            self.assertLess(loudness(video, 0.1, 0.7), -60)
            self.assertGreater(loudness(video, 1.2, 0.6), -20)
            self.assertLess(loudness(video, 2.3, 0.6), -60)

            muted = project.model_copy(
                update={"tracks": [t.model_copy(update={"muted": True}) for t in project.tracks]}
            )
            self.assertLess(loudness(render(root, muted), 1.2, 0.6), -60)

    def test_a_span_renders_only_that_part_of_the_edit_from_its_start(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            write_image(root, "blue.png", color=BLUE)
            write_wav(root, "tone.wav", seconds=2)
            sound = VideoProjectClip(
                id=new_id(), track_id="a1", kind="audio", source_id="tone.wav", start=3.0,
                duration=1.0,
            )  # fmt: skip
            clips = [still("red.png", "v1", 0, 2), still("blue.png", "v1", 2, 3), sound]
            project = project_with(root, clips, sources=["red.png", "blue.png", "tone.wav"])

            video = render(root, project, VideoProjectExportSpan(start=1.5, end=3.5))

            probe = subprocess.run(
                [ffmpeg_path() or "", "-i", str(video)], capture_output=True, text=True
            ).stderr
            self.assertIn("Duration: 00:00:02.0", probe)
            self.assertTrue(close(pixel(video, 0.2), RED))
            self.assertTrue(close(pixel(video, 1.0), BLUE))
            self.assertLess(loudness(video, 0.1, 1.2), -60)
            self.assertGreater(loudness(video, 1.6, 0.3), -20)


class RenderWindowTests(unittest.TestCase):
    def test_clips_far_from_the_span_are_left_out_and_the_rest_move_by_whole_frames(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            early = still("red.png", "v1", 0, 1)
            crossing = still("red.png", "v1", 4.05, 2)
            project = project_with(root, [early, crossing], sources=["red.png"])

            window = render_window(project, VideoProjectExportSpan(start=5, end=5.5))

            self.assertEqual([clip.id for clip in window.project.clips], [crossing.id])
            self.assertAlmostEqual(window.project.clips[0].start, 0.05)
            self.assertAlmostEqual(window.head, 1.0)
            self.assertAlmostEqual(window.length, 0.5)

    def test_a_span_past_the_end_of_the_edit_is_refused(self) -> None:
        with TempMediaFolder() as root:
            write_image(root, "red.png", color=RED)
            project = project_with(root, [still("red.png", "v1", 0, 1)], sources=["red.png"])

            with self.assertRaisesRegex(ValueError, "past the end"):
                render_window(project, VideoProjectExportSpan(start=2, end=3))


if __name__ == "__main__":
    unittest.main()
