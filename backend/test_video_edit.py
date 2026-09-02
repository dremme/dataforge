"""Even-rounding cases must stay in step with ``frontend/src/features/gallery/lib/videoEdit.test.ts``."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

import edit_sidecars
import video_edit
from constants import EDIT_STALE_SUFFIX, EDIT_TEMP_SUFFIX, VIDEO_EDIT_MUXERS
from ffmpeg_run import FfmpegCancelled
from schemas import EditCropRect, MaskRegion, VideoEditSpec
from testing_fixtures import TempMediaFolder, write_mp4_video

SOURCE = Path("clip.mp4.bak")
DESTINATION = Path("clip.mp4.edit-tmp")

HEAD = [
    "ffmpeg",
    "-nostdin",
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-y",
]
MAPS = ["-map", "0:v:0", "-map", "0:a:0?"]
VIDEO_CODEC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
AUDIO_REENCODE = ["-c:a", "aac", "-b:a", "192k"]
AUDIO_COPY = ["-c:a", "copy"]
FASTSTART = ["-movflags", "+faststart"]


def command_for(
    spec: VideoEditSpec,
    *,
    muxer: str = "mp4",
    frame_rate: float | None = None,
    source_size: tuple[int, int] | None = None,
) -> list[str]:
    return video_edit.build_video_edit_command(
        SOURCE,
        DESTINATION,
        spec,
        executable="ffmpeg",
        muxer=muxer,
        frame_rate=frame_rate,
        source_size=source_size,
    )


def graph_for(spec: VideoEditSpec, size: tuple[int, int] = (640, 360)) -> str:
    command = command_for(spec, source_size=size)
    return command[command.index("-filter_complex") + 1]


def even_trunc(value: float) -> int:
    """The Python twin of ``trunc(x/2)*2``, so the table below reads as one thing."""
    return int(value / 2) * 2


class BuildVideoEditCommandTests(unittest.TestCase):
    def test_an_untouched_spec_only_remuxes(self) -> None:
        self.assertEqual(
            command_for(VideoEditSpec()),
            [
                *HEAD,
                "-i",
                str(SOURCE),
                *MAPS,
                *VIDEO_CODEC,
                *AUDIO_COPY,
                *FASTSTART,
                "-f",
                "mp4",
                str(DESTINATION),
            ],
        )

    def test_trim_uses_input_seeking_and_a_duration(self) -> None:
        """As output options these would be measured on the retimed output timeline."""
        command = command_for(VideoEditSpec(trim_start=1.5, trim_end=4.75))

        self.assertEqual(
            command,
            [
                *HEAD,
                "-ss",
                "1.500",
                "-t",
                "3.250",
                "-i",
                str(SOURCE),
                *MAPS,
                *VIDEO_CODEC,
                *AUDIO_REENCODE,
                *FASTSTART,
                "-f",
                "mp4",
                str(DESTINATION),
            ],
        )
        self.assertLess(command.index("-ss"), command.index("-i"))
        self.assertLess(command.index("-t"), command.index("-i"))

    def test_an_open_ended_trim_omits_the_duration(self) -> None:
        command = command_for(VideoEditSpec(trim_start=2.0))

        self.assertIn("-ss", command)
        self.assertNotIn("-t", command)

    def test_a_trim_from_zero_omits_the_seek(self) -> None:
        command = command_for(VideoEditSpec(trim_end=3.0))

        self.assertNotIn("-ss", command)
        self.assertEqual(command[command.index("-t") + 1], "3.000")

    def test_crop_is_expressed_against_the_frame_variables(self) -> None:
        spec = VideoEditSpec(crop=EditCropRect(x=0.1, y=0.2, width=0.5, height=0.6))

        self.assertEqual(
            command_for(spec)[command_for(spec).index("-vf") + 1],
            "crop=trunc(iw*0.500000/2)*2:trunc(ih*0.600000/2)*2"
            ":trunc(iw*0.100000/2)*2:trunc(ih*0.200000/2)*2",
        )

    def test_scale_truncates_both_axes_the_same_way(self) -> None:
        command = command_for(VideoEditSpec(scale=0.5))

        self.assertEqual(
            command[command.index("-vf") + 1],
            "scale=trunc(iw*0.500000/2)*2:trunc(ih*0.500000/2)*2",
        )

    def test_filters_run_crop_then_scale_then_retime(self) -> None:
        spec = VideoEditSpec(
            crop=EditCropRect(x=0.0, y=0.25, width=1.0, height=0.5), speed=2.0, scale=0.5
        )
        command = command_for(spec)

        filters = command[command.index("-vf") + 1].split(",")
        self.assertEqual([name.split("=")[0] for name in filters], ["crop", "scale", "setpts"])
        self.assertEqual(filters[-1], "setpts=PTS/2.000000")

    def test_color_uses_the_shared_rgb_matrix_after_the_geometry_and_timing_filters(self) -> None:
        spec = VideoEditSpec(scale=0.5, speed=2.0, brightness=1.2, hue=45.0)

        filters = command_for(spec, frame_rate=24.0)
        chain = filters[filters.index("-vf") + 1]

        self.assertLess(chain.index("scale="), chain.index("setpts=PTS/2.000000"))
        self.assertLess(chain.index("setpts=PTS/2.000000"), chain.index("fps=24.000000"))
        self.assertLess(chain.index("fps=24.000000"), chain.index("format=rgb24,geq="))
        self.assertIn("r='clip(", chain)
        self.assertIn("r(X,Y)", chain)
        self.assertIn("g(X,Y)", chain)
        self.assertIn("b(X,Y)", chain)

    def test_an_identity_spec_carries_no_filters(self) -> None:
        self.assertNotIn("-vf", command_for(VideoEditSpec()))
        self.assertNotIn("-af", command_for(VideoEditSpec()))

    def test_retiming_pins_the_rate_back_to_the_source(self) -> None:
        """`setpts` keeps every frame and compresses timestamps; without fps a 2x 24fps clip becomes 48fps."""
        command = command_for(VideoEditSpec(speed=2.0), frame_rate=24.0)

        self.assertEqual(
            command[command.index("-vf") + 1],
            "setpts=PTS/2.000000,fps=24.000000",
        )

    def test_the_rate_is_pinned_after_the_retime_not_before(self) -> None:
        # Ordered the other way it would resample the source and then retime the result.
        filters = command_for(VideoEditSpec(speed=0.5), frame_rate=30.0)
        chain = filters[filters.index("-vf") + 1].split(",")

        self.assertEqual([name.split("=")[0] for name in chain], ["setpts", "fps"])

    def test_an_unreadable_rate_leaves_the_output_rate_to_ffmpeg(self) -> None:
        command = command_for(VideoEditSpec(speed=2.0), frame_rate=None)

        self.assertEqual(command[command.index("-vf") + 1], "setpts=PTS/2.000000")

    def test_an_edit_that_does_not_retime_is_left_at_its_own_rate(self) -> None:
        """Resampling a clip whose timing nothing touched would only cost it frames."""
        command = command_for(VideoEditSpec(scale=0.5), frame_rate=24.0)

        self.assertNotIn("fps=", command[command.index("-vf") + 1])

    def test_speeding_up_retimes_the_audio_too(self) -> None:
        command = command_for(VideoEditSpec(speed=2.0))

        self.assertEqual(command[command.index("-af") + 1], "atempo=2.000000")
        self.assertIn("-c:a", command)
        self.assertEqual(command[command.index("-c:a") + 1], "aac")

    def test_the_optional_audio_stream_is_always_mapped(self) -> None:
        """There is no ffprobe here to ask whether the source has a track."""
        for spec in (VideoEditSpec(), VideoEditSpec(speed=0.5), VideoEditSpec(scale=0.25)):
            with self.subTest(spec=spec):
                self.assertIn("0:a:0?", command_for(spec))

    def test_audio_is_copied_only_when_nothing_disturbs_it(self) -> None:
        cropped = command_for(VideoEditSpec(crop=EditCropRect(width=0.5)))
        trimmed = command_for(VideoEditSpec(trim_end=2.0))
        unchanged_volume = command_for(VideoEditSpec(volume=1.0))

        self.assertEqual(cropped[cropped.index("-c:a") + 1], "copy")
        self.assertEqual(trimmed[trimmed.index("-c:a") + 1], "aac")
        self.assertEqual(unchanged_volume[unchanged_volume.index("-c:a") + 1], "copy")

    def test_a_volume_change_filters_the_audio_and_re_encodes(self) -> None:
        command = command_for(VideoEditSpec(volume=0.5))

        self.assertEqual(command[command.index("-af") + 1], "volume=0.500000")
        self.assertEqual(command[command.index("-c:a") + 1], "aac")

    def test_a_retime_and_a_volume_change_share_one_audio_chain(self) -> None:
        command = command_for(VideoEditSpec(speed=2.0, volume=0.5))

        self.assertEqual(command[command.index("-af") + 1], "atempo=2.000000,volume=0.500000")

    def test_muting_drops_the_audio_stream_rather_than_filtering_it(self) -> None:
        command = command_for(VideoEditSpec(volume=0.0))

        self.assertIn("-an", command)
        self.assertNotIn("0:a:0?", command)
        self.assertNotIn("-af", command)
        self.assertNotIn("-c:a", command)

    def test_muting_still_drops_the_audio_when_regions_take_the_filtergraph(self) -> None:
        command = command_for(
            VideoEditSpec(volume=0.0, masks=[MaskRegion(x=0.1, y=0.1, width=0.3, height=0.3)]),
            source_size=(640, 360),
        )

        self.assertIn("-an", command)
        self.assertNotIn("0:a:0?", command)

    def test_every_supported_container_is_named_and_gets_faststart(self) -> None:
        for extension, muxer in VIDEO_EDIT_MUXERS.items():
            with self.subTest(extension=extension):
                command = command_for(VideoEditSpec(), muxer=muxer)
                self.assertIn("-movflags", command)
                self.assertEqual(command[command.index("-f") + 1], muxer)

    def test_the_muxer_is_named_because_the_temp_file_has_no_media_suffix(self) -> None:
        command = command_for(VideoEditSpec())

        self.assertEqual(command[-3:], ["-f", "mp4", str(DESTINATION)])


class MaskFiltergraphTests(unittest.TestCase):
    """Region geometry is in whole even pixels; ``gblur`` cannot read ``iw`` the way ``crop`` can."""

    def region(self, **overrides: object) -> MaskRegion:
        values: dict[str, object] = {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.3}
        values.update(overrides)
        return MaskRegion(**values)

    def test_a_spec_without_regions_keeps_the_linear_filter_chain(self) -> None:
        command = command_for(VideoEditSpec(scale=0.5), source_size=(640, 360))

        self.assertNotIn("-filter_complex", command)
        self.assertIn("-vf", command)

    def test_regions_move_the_video_onto_a_filtergraph_and_map_its_output(self) -> None:
        command = command_for(VideoEditSpec(masks=[self.region()]), source_size=(640, 360))

        self.assertIn("-filter_complex", command)
        self.assertNotIn("-vf", command)
        self.assertEqual(command[command.index("-map") + 1], "[v]")
        self.assertIn("0:a:0?", command)

    def test_the_frame_is_split_once_for_each_region_plus_the_base(self) -> None:
        graph = graph_for(VideoEditSpec(masks=[self.region(), self.region(x=0.5)]))

        self.assertIn("[0:v]split=3[base][cut0][cut1]", graph)

    def test_every_region_is_overlaid_back_where_it_was_cut_from(self) -> None:
        graph = graph_for(VideoEditSpec(masks=[self.region(mode="pixelate")]))

        # 10% of 640 and of 360, both already even.
        self.assertIn("crop=192:108:64:36", graph)
        self.assertIn("[base][mask0]overlay=64:36[over0]", graph)

    def test_a_blur_widens_its_cut_and_trims_the_padding_back_off(self) -> None:
        graph = graph_for(VideoEditSpec(masks=[self.region(mode="blur", strength=0.1)]))

        # 10% of the region's 108px short side is a sigma of 2.7, so 6px of padding each way.
        self.assertIn("crop=204:120:58:30,gblur=sigma=2.700000,crop=192:108:6:6", graph)

    def test_a_mosaic_averages_down_and_comes_back_up_on_hard_edges(self) -> None:
        graph = graph_for(VideoEditSpec(masks=[self.region(mode="pixelate", strength=0.25)]))

        # A quarter of 108 rounds to an even 26, which divides the region into 7 by 4 blocks.
        self.assertIn("crop=192:108:64:36,scale=7:4:flags=area,scale=192:108:flags=neighbor", graph)

    def test_a_blackout_fills_its_cut_and_measures_no_strength(self) -> None:
        graph = graph_for(VideoEditSpec(masks=[self.region(mode="blackout", strength=0.5)]))

        self.assertIn("crop=192:108:64:36,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill", graph)
        self.assertNotIn("gblur", graph)
        self.assertNotIn("flags=", graph)

    def test_a_blackout_takes_its_turn_in_the_overlay_order(self) -> None:
        graph = graph_for(
            VideoEditSpec(masks=[self.region(mode="blur"), self.region(x=0.5, mode="blackout")])
        )

        self.assertIn("[base][mask0]overlay=", graph)
        self.assertIn("[over0][mask1]overlay=", graph)

    def test_the_crop_and_scale_run_after_the_regions_are_laid_in(self) -> None:
        spec = VideoEditSpec(masks=[self.region()], crop=EditCropRect(width=0.5), scale=0.5)

        graph = graph_for(spec)

        overlay = graph.index("overlay=")
        self.assertLess(overlay, graph.index("crop=trunc(iw*"))
        self.assertLess(graph.index("crop=trunc(iw*"), graph.index("scale=trunc(iw*"))

    def test_a_spec_that_only_masks_still_terminates_the_graph(self) -> None:
        graph = graph_for(VideoEditSpec(masks=[self.region()]))

        self.assertTrue(graph.endswith("[over0]null[v]"))

    def test_every_edge_of_a_region_lands_on_an_even_pixel(self) -> None:
        region = self.region(x=0.077, y=0.077, width=0.313, height=0.313)

        left, top, right, bottom = video_edit.mask_box((640, 360), region)

        for edge in (left, top, right, bottom):
            self.assertEqual(edge % 2, 0)

    def test_a_region_too_small_to_measure_still_leaves_two_pixels(self) -> None:
        left, top, right, bottom = video_edit.mask_box(
            (640, 360), self.region(x=0.999, y=0.999, width=0.001, height=0.001)
        )

        self.assertGreaterEqual(right - left, 2)
        self.assertGreaterEqual(bottom - top, 2)

    def test_padding_never_reaches_outside_the_frame(self) -> None:
        box = video_edit.mask_box((640, 360), self.region(x=0.0, y=0.0, width=0.2, height=0.2))

        left, top, right, bottom = video_edit.padded_box((640, 360), box, 40)

        self.assertEqual((left, top), (0, 0))
        self.assertLessEqual(right, 640)
        self.assertLessEqual(bottom, 360)

    def test_an_unreadable_frame_size_refuses_rather_than_dropping_the_regions(self) -> None:
        """Rendering the rest would hand back a file that looks edited but hides nothing."""
        with self.assertRaises(RuntimeError):
            command_for(VideoEditSpec(masks=[self.region()], scale=0.5), source_size=None)

    def test_a_spec_without_regions_does_not_need_a_frame_size(self) -> None:
        command = command_for(VideoEditSpec(scale=0.5), source_size=None)

        self.assertIn("-vf", command)


class AtempoChainTests(unittest.TestCase):
    def test_a_single_link_covers_the_documented_range(self) -> None:
        self.assertEqual(video_edit.atempo_chain(1.5), "atempo=1.500000")
        self.assertEqual(video_edit.atempo_chain(0.75), "atempo=0.750000")

    def test_the_extremes_are_expressed_as_two_links(self) -> None:
        self.assertEqual(video_edit.atempo_chain(4.0), "atempo=2.000000,atempo=2.000000")
        self.assertEqual(video_edit.atempo_chain(0.25), "atempo=0.500000,atempo=0.500000")

    def test_an_uneven_factor_keeps_every_link_in_range(self) -> None:
        chain = video_edit.atempo_chain(3.0)

        factors = [float(link.split("=")[1]) for link in chain.split(",")]
        self.assertAlmostEqual(factors[0] * factors[1], 3.0)
        for factor in factors:
            self.assertGreaterEqual(factor, video_edit.MIN_ATEMPO)
            self.assertLessEqual(factor, video_edit.MAX_ATEMPO)

    def test_unchanged_speed_has_no_links(self) -> None:
        self.assertEqual(video_edit.atempo_chain(1.0), "")


class OutputDimensionsTests(unittest.TestCase):
    """Mirrors the frontend table; see this module's docstring."""

    CASES = (
        ((1920, 1080), 1.0, 1.0, 1.0, (1920, 1080)),
        ((1920, 1080), 1.0, 1.0, 0.5, (960, 540)),
        ((1920, 1080), 0.5, 0.5, 1.0, (960, 540)),
        ((1920, 1080), 0.5, 0.5, 0.5, (480, 270)),
        ((1920, 1080), 1.0, 1.0, 0.75, (1440, 810)),
        ((1919, 1081), 1.0, 1.0, 1.0, (1918, 1080)),
        ((1919, 1081), 0.333, 0.333, 1.0, (638, 358)),
        ((640, 480), 1.0, 1.0, 0.25, (160, 120)),
        ((641, 481), 1.0, 1.0, 0.25, (160, 120)),
    )

    def test_even_truncation_matches_the_shared_table(self) -> None:
        for source, crop_w, crop_h, scale, expected in self.CASES:
            with self.subTest(source=source, crop=(crop_w, crop_h), scale=scale):
                cropped_width = even_trunc(source[0] * crop_w)
                cropped_height = even_trunc(source[1] * crop_h)
                self.assertEqual(
                    (even_trunc(cropped_width * scale), even_trunc(cropped_height * scale)),
                    expected,
                )


class SpecHelperTests(unittest.TestCase):
    def test_a_default_spec_is_identity(self) -> None:
        self.assertTrue(video_edit.is_identity_spec(VideoEditSpec()))

    def test_any_single_change_breaks_identity(self) -> None:
        changed = (
            VideoEditSpec(trim_start=0.5),
            VideoEditSpec(trim_end=3.0),
            VideoEditSpec(speed=2.0),
            VideoEditSpec(scale=0.5),
            VideoEditSpec(crop=EditCropRect(width=0.5)),
            VideoEditSpec(masks=[MaskRegion(x=0.1, y=0.1, width=0.3, height=0.3)]),
            VideoEditSpec(volume=0.5),
            VideoEditSpec(volume=0.0),
            VideoEditSpec(brightness=1.2),
            VideoEditSpec(contrast=0.8),
            VideoEditSpec(saturation=1.5),
            VideoEditSpec(warmth=0.4),
            VideoEditSpec(hue=30.0),
        )
        for spec in changed:
            with self.subTest(spec=spec):
                self.assertFalse(video_edit.is_identity_spec(spec))

    def test_a_volume_outside_the_range_is_refused(self) -> None:
        for volume in (-0.1, 2.5):
            with self.subTest(volume=volume), self.assertRaises(ValidationError):
                VideoEditSpec(volume=volume)

    def test_color_outside_the_range_is_refused(self) -> None:
        for kwargs in (
            {"brightness": 2.5},
            {"contrast": -0.1},
            {"saturation": 3.0},
            {"warmth": 1.5},
            {"hue": 360.0},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                VideoEditSpec(**kwargs)

    def test_expected_output_length_divides_the_kept_span_by_the_speed(self) -> None:
        spec = VideoEditSpec(trim_start=2.0, trim_end=10.0, speed=2.0)

        self.assertEqual(video_edit.expected_output_seconds(spec), 4.0)

    def test_an_open_ended_trim_has_no_predictable_length(self) -> None:
        self.assertIsNone(video_edit.expected_output_seconds(VideoEditSpec()))

    def test_a_probed_runtime_gives_an_open_ended_retime_a_length(self) -> None:
        """Without this a speed-only edit renders behind an indeterminate progress bar."""
        spec = VideoEditSpec(speed=2.0)

        self.assertEqual(video_edit.expected_output_seconds(spec, 10.0), 5.0)

    def test_a_stated_trim_end_wins_over_the_probe(self) -> None:
        spec = VideoEditSpec(trim_start=2.0, trim_end=10.0, speed=2.0)

        self.assertEqual(video_edit.expected_output_seconds(spec, 60.0), 4.0)

    def test_the_backup_is_named_after_the_whole_filename(self) -> None:
        """`with_suffix` would give `clip.bak` and collide across containers."""
        self.assertEqual(edit_sidecars.backup_path_for(Path("/data/clip.mp4")).name, "clip.mp4.bak")
        self.assertEqual(edit_sidecars.backup_path_for(Path("/data/clip.mov")).name, "clip.mov.bak")

    def test_the_spec_sidecar_sits_two_suffixes_deep(self) -> None:
        self.assertEqual(
            edit_sidecars.edit_spec_path(Path("/data/clip.mp4")).name, "clip.edit.json"
        )

    def test_an_uneditable_container_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            video_edit.resolve_muxer(Path("clip.avi"))


class ProbeSourceTests(unittest.TestCase):
    """A fake capture keeps OpenCV's C++ warning for an unreadable file off the suite."""

    #: The real cv2 values, so a capture handed the wrong one is still recognisable.
    CAP_PROP_FPS = 5
    CAP_PROP_FRAME_WIDTH = 3
    CAP_PROP_FRAME_HEIGHT = 4
    CAP_PROP_FRAME_COUNT = 7

    def _fake_cv2(
        self,
        *,
        fps: float,
        size: tuple[int, int] = (800, 450),
        frames: float = 240.0,
        opened: bool = True,
    ):
        released: list[bool] = []
        properties = {
            ProbeSourceTests.CAP_PROP_FPS: fps,
            ProbeSourceTests.CAP_PROP_FRAME_WIDTH: size[0],
            ProbeSourceTests.CAP_PROP_FRAME_HEIGHT: size[1],
            ProbeSourceTests.CAP_PROP_FRAME_COUNT: frames,
        }

        class FakeCapture:
            def isOpened(inner) -> bool:  # mirrors the cv2 API
                return opened

            def get(inner, prop: int) -> float:
                return properties[prop]

            def release(inner) -> None:
                released.append(True)

        fake = type(
            "cv2",
            (),
            {
                "VideoCapture": staticmethod(lambda _path: FakeCapture()),
                "CAP_PROP_FPS": self.CAP_PROP_FPS,
                "CAP_PROP_FRAME_WIDTH": self.CAP_PROP_FRAME_WIDTH,
                "CAP_PROP_FRAME_HEIGHT": self.CAP_PROP_FRAME_HEIGHT,
                "CAP_PROP_FRAME_COUNT": self.CAP_PROP_FRAME_COUNT,
            },
        )
        return fake, released

    def _probe(self, **kwargs):
        fake, released = self._fake_cv2(**kwargs)
        with patch.dict("sys.modules", {"cv2": fake}):
            return video_edit.probe_source(Path("clip.mp4")), released

    def test_reports_a_plausible_rate_and_the_frame_size(self) -> None:
        probe, _ = self._probe(fps=23.976)

        self.assertEqual(probe.frame_rate, 23.976)
        self.assertEqual(probe.size, (800, 450))

    def test_reports_the_runtime_from_the_frame_count(self) -> None:
        """An untrimmed retime has no end of its own; this is where the progress bar gets one."""
        probe, _ = self._probe(fps=24.0, frames=240.0)

        self.assertAlmostEqual(probe.seconds or 0.0, 10.0)

    def test_reports_no_runtime_when_the_container_counts_nothing(self) -> None:
        probe, _ = self._probe(fps=24.0, frames=0.0)

        self.assertIsNone(probe.seconds)
        self.assertEqual(probe.frame_rate, 24.0)

    def test_releases_the_capture_even_when_it_never_opened(self) -> None:
        # An unreleased capture holds the file on Windows, against the replace this render performs.
        probe, released = self._probe(fps=24.0, opened=False)

        self.assertIsNone(probe.frame_rate)
        self.assertIsNone(probe.size)
        self.assertEqual(released, [True])

    def test_rejects_a_rate_the_container_cannot_mean(self) -> None:
        for fps in (0.0, -1.0, float("nan"), float("inf"), video_edit.MAX_PLAUSIBLE_FPS + 1):
            with self.subTest(fps=fps):
                self.assertIsNone(self._probe(fps=fps)[0].frame_rate)

    def test_an_unmeasurable_frame_keeps_the_rate_it_did_read(self) -> None:
        probe, _ = self._probe(fps=24.0, size=(0, 0))

        self.assertEqual(probe.frame_rate, 24.0)
        self.assertIsNone(probe.size)


class ApplyVideoEditTests(unittest.TestCase):
    """The runner is replaced; what is checked is what it was asked to do."""

    def setUp(self) -> None:
        # Header-only fixtures: a real probe would fail and log a C++ warning.
        patcher = patch(
            "video_edit.probe_source",
            return_value=video_edit.SourceProbe(frame_rate=24.0, size=(800, 450)),
        )
        self.probe = patcher.start()
        self.addCleanup(patcher.stop)

    def _render(self, content: bytes = b"rendered"):
        def run(command, **_kwargs):
            Path(command[-1]).write_bytes(content)

        return run

    def test_regions_survive_the_trip_through_apply(self) -> None:
        """The backup has no media suffix, so a header-only size read hands back nothing."""
        commands: list[list[str]] = []

        def run(command, **_kwargs):
            commands.append(command)
            Path(command[-1]).write_bytes(b"rendered")

        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4", width=800, height=450)
            spec = VideoEditSpec(masks=[MaskRegion(x=0.1, y=0.1, width=0.3, height=0.3)])

            with patch("video_edit.run_ffmpeg", side_effect=run):
                video_edit.apply_video_edit(media, spec, ffmpeg="ffmpeg")

        self.assertIn("-filter_complex", commands[0])
        graph = commands[0][commands[0].index("-filter_complex") + 1]
        self.assertIn("gblur", graph)

    def test_the_render_reads_the_backup_and_publishes_over_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            captured: list[list[str]] = []

            def run(command, **kwargs):
                captured.append(command)
                self._render()(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=run):
                result = video_edit.apply_video_edit(
                    media, VideoEditSpec(speed=2.0), ffmpeg="ffmpeg"
                )

            command = captured[0]
            self.assertEqual(command[command.index("-i") + 1], str(root / "clip.mp4.bak"))
            self.assertEqual(command[-1], str(root / f"clip.mp4{EDIT_TEMP_SUFFIX}"))
            self.assertEqual(media.read_bytes(), b"rendered")
            self.assertTrue(result.has_backup)
            self.assertEqual(result.path, str(media))

    def test_the_source_is_probed_from_the_backup_the_render_reads(self) -> None:
        # Not from the live file: an earlier edit may already have retimed that one.
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            captured: list[list[str]] = []

            def run(command, **kwargs):
                captured.append(command)
                self._render()(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=run):
                video_edit.apply_video_edit(media, VideoEditSpec(speed=2.0), ffmpeg="ffmpeg")

            self.probe.assert_called_once_with(root / "clip.mp4.bak")
            command = captured[0]
            self.assertIn("fps=24.000000", command[command.index("-vf") + 1])

    def test_a_second_edit_still_starts_from_the_untouched_original(self) -> None:
        """The whole of "changes are taken from the backup", as one assertion."""
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            edit_sidecars.backup_path_for(media).write_bytes(b"pristine-original")
            captured: list[list[str]] = []

            def run(command, **kwargs):
                captured.append(command)
                self._render(b"second-render")(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=run):
                video_edit.apply_video_edit(media, VideoEditSpec(speed=2.0), ffmpeg="ffmpeg")
                video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(
                edit_sidecars.backup_path_for(media).read_bytes(), b"pristine-original"
            )
            for command in captured:
                self.assertEqual(command[command.index("-i") + 1], str(root / "clip.mp4.bak"))

    def test_the_applied_spec_is_stored_beside_the_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            spec = VideoEditSpec(trim_start=1.0, trim_end=4.0, scale=0.5)

            with patch("video_edit.run_ffmpeg", side_effect=self._render()):
                video_edit.apply_video_edit(media, spec, ffmpeg="ffmpeg")

            self.assertEqual(video_edit.read_edit_spec(media), spec)

    def test_the_temp_file_never_carries_a_media_suffix(self) -> None:
        """One that did would surface as a phantom gallery item mid-render."""
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            seen: list[str] = []

            def run(command, **kwargs):
                seen.append(Path(command[-1]).suffix)
                self._render()(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=run):
                video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(seen, [EDIT_TEMP_SUFFIX])
            self.assertEqual(list(root.glob(f"*{EDIT_TEMP_SUFFIX}")), [])

    def test_a_failed_render_leaves_the_file_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()

            with patch("video_edit.run_ffmpeg", side_effect=RuntimeError("bad filter")):
                with self.assertRaises(RuntimeError):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(root.glob(f"*{EDIT_TEMP_SUFFIX}")), [])
            self.assertIsNone(video_edit.read_edit_spec(media))

    def test_a_failed_render_keeps_the_backup_it_just_made(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.run_ffmpeg", side_effect=RuntimeError("bad filter")):
                with self.assertRaises(RuntimeError):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertTrue(edit_sidecars.backup_path_for(media).is_file())

    def test_a_cancelled_render_leaves_nothing_behind(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()

            def run(command, **_kwargs):
                Path(command[-1]).write_bytes(b"partial")
                raise FfmpegCancelled

            with patch("video_edit.run_ffmpeg", side_effect=run):
                with self.assertRaises(FfmpegCancelled):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(root.glob(f"*{EDIT_TEMP_SUFFIX}")), [])

    def test_leftovers_from_a_hard_kill_are_swept_first(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            (root / f"other.mp4{EDIT_TEMP_SUFFIX}").write_bytes(b"junk")
            (root / f"other.mp4{EDIT_STALE_SUFFIX}").write_bytes(b"junk")

            with patch("video_edit.run_ffmpeg", side_effect=self._render()):
                video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(list(root.glob(f"*{EDIT_TEMP_SUFFIX}")), [])
            self.assertEqual(list(root.glob(f"*{EDIT_STALE_SUFFIX}")), [])

    def test_a_missing_ffmpeg_is_reported_rather_than_guessed_at(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.ffmpeg_path", return_value=None):
                with self.assertRaises(RuntimeError) as caught:
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5))

            self.assertEqual(str(caught.exception), video_edit.FFMPEG_MISSING_MESSAGE)

    def test_an_uneditable_container_never_reaches_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            media = root / "clip.avi"
            media.write_bytes(b"not-really-an-avi")

            with patch("video_edit.run_ffmpeg") as runner:
                with self.assertRaises(ValueError):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            runner.assert_not_called()


class RevertVideoEditTests(unittest.TestCase):
    def test_the_original_comes_back_and_both_sidecars_go(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            edit_sidecars.backup_path_for(media).write_bytes(b"pristine-original")
            edit_sidecars.write_spec(media, VideoEditSpec(scale=0.5))

            result = video_edit.revert_video_edit(media)

            self.assertEqual(media.read_bytes(), b"pristine-original")
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())
            self.assertFalse(edit_sidecars.edit_spec_path(media).exists())
            self.assertFalse(result.has_backup)

    def test_reverting_without_a_backup_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with self.assertRaises(ValueError):
                video_edit.revert_video_edit(media)

    def test_a_failed_install_keeps_the_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            backup = edit_sidecars.backup_path_for(media)
            backup.write_bytes(b"pristine-original")

            with patch("edit_sidecars.publish_replacing", side_effect=OSError("denied")):
                with self.assertRaises(OSError):
                    video_edit.revert_video_edit(media)

            self.assertEqual(backup.read_bytes(), b"pristine-original")
            self.assertEqual(list(root.glob(f"*{EDIT_TEMP_SUFFIX}")), [])


if __name__ == "__main__":
    unittest.main()
