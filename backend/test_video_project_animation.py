"""Keyframes, crossfades, track and master levels, and ducking, rendered with the real ffmpeg.

Pictures are read back frame by frame and sound in short windows, and compared with what
``video_project_animation`` says the value is at that time: the rule the preview also follows.
"""

from __future__ import annotations

import math
import struct
import subprocess
import unittest
from pathlib import Path

from pydantic import ValidationError

from testing_fixtures import isolate_test_database

isolate_test_database()

from constants import AUDIO_EQ_MID_HZ, VIDEO_PROJECT_DUCK_RAMP_SECONDS
from schemas import (
    AudioEffects,
    VideoProject,
    VideoProjectClip,
    VideoProjectKeyframe,
    VideoProjectKeyframes,
    VideoProjectMix,
    VideoProjectTitle,
    VideoProjectTrack,
    VideoProjectTransform,
)
from test_video_project_workflow import ffmpeg, generate, render_small, write_still
from testing_fixtures import TempMediaFolder
from video_project import probe_source_file, source_from_info
from video_project_animation import duck_level, ease, keyframe_value

RATE = 24
WIDTH = 320
HEIGHT = 180
WHITE = (255, 255, 255)


def key(time: float, value: float, easing: str = "linear") -> VideoProjectKeyframe:
    return VideoProjectKeyframe(time=time, value=value, easing=easing)


def tracks(**patches: dict) -> list[VideoProjectTrack]:
    listed = [
        VideoProjectTrack(id="v1", kind="video", name="V1"),
        VideoProjectTrack(id="a1", kind="audio", name="A1"),
        VideoProjectTrack(id="a2", kind="audio", name="A2"),
    ]
    return [track.model_copy(update=patches.get(track.id, {})) for track in listed]


def make_project(root: Path, names: list[str], clips: list[VideoProjectClip], **fields):
    defaults = {
        "id": "animation",
        "name": "Animation",
        "created_at": "now",
        "updated_at": "now",
        "width": WIDTH,
        "height": HEIGHT,
        "frame_rate": RATE,
        "sources": [source_from_info(probe_source_file(root / name), name) for name in names],
        "tracks": tracks(),
        "clips": clips,
    }
    return VideoProject(**{**defaults, **fields})


def still_clip(seconds: float, **fields) -> VideoProjectClip:
    return VideoProjectClip(
        id="still",
        track_id="v1",
        kind="image",
        source_id="white.png",
        start=0,
        duration=seconds,
        **fields,
    )


def frames(video: Path) -> list[bytes]:
    result = subprocess.run(
        [
            *(ffmpeg(), "-v", "error", "-i", str(video), "-fps_mode", "passthrough"),
            *("-f", "rawvideo", "-pix_fmt", "gray", "-"),
        ],
        capture_output=True,
        check=True,
    )
    size = WIDTH * HEIGHT
    return [result.stdout[at : at + size] for at in range(0, len(result.stdout) - size + 1, size)]


def lit_box(frame: bytes) -> tuple[float, float, int, int]:
    """Centre and size of the pixels brighter than mid grey."""
    xs = [index % WIDTH for index, value in enumerate(frame) if value > 128]
    ys = [index // WIDTH for index, value in enumerate(frame) if value > 128]
    assert xs, "nothing is drawn"
    return (
        (min(xs) + max(xs) + 1) / 2,
        (min(ys) + max(ys) + 1) / 2,
        max(xs) - min(xs) + 1,
        max(ys) - min(ys) + 1,
    )


def samples(video: Path) -> list[float]:
    """The left channel at 48 kHz."""
    result = subprocess.run(
        [ffmpeg(), "-v", "error", "-i", str(video), "-map", "0:a:0", "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    values = struct.unpack(f"<{len(result.stdout) // 4}f", result.stdout)
    return list(values[0::2])


def rms(values: list[float], at: float, window: float = 0.1) -> float:
    begin = round((at - window / 2) * 48000)
    part = values[begin : begin + round(window * 48000)]
    return math.sqrt(sum(value * value for value in part) / len(part))


def write_sine(root: Path, name: str, amplitude: float, frequency: int, seconds: float) -> Path:
    tone = f"{amplitude}*sin(2*PI*{frequency}*t)"
    return generate(root, name, "-f", "lavfi", "-i", f"aevalsrc={tone}|{tone}:s=48000:d={seconds}")


def audio_clip(clip_id: str, track: str, name: str, start: float, seconds: float, **fields):
    return VideoProjectClip(
        id=clip_id,
        track_id=track,
        kind="audio",
        source_id=name,
        start=start,
        duration=seconds,
        **fields,
    )


def spacer(seconds: float) -> VideoProjectClip:
    return VideoProjectClip(
        id="spacer",
        track_id="v1",
        kind="title",
        start=0,
        duration=seconds,
        title=VideoProjectTitle(text=""),
    )


class KeyframeRuleTests(unittest.TestCase):
    """The same numbers are checked in ``lib/keyframes.test.ts``."""

    def test_values_hold_outside_the_keys_and_ease_between_them(self) -> None:
        keys = [key(1, 0.2, "ease_in_out"), key(3, 0.6, "hold"), key(4, 1.0)]
        self.assertEqual(keyframe_value(keys, 0, 9), 0.2)
        self.assertAlmostEqual(keyframe_value(keys, 1.5, 9), 0.2 + 0.4 * 0.15625)
        self.assertAlmostEqual(keyframe_value(keys, 2, 9), 0.4)
        self.assertEqual(keyframe_value(keys, 3.9, 9), 0.6)
        self.assertEqual(keyframe_value(keys, 5, 9), 1.0)
        self.assertEqual(keyframe_value([], 5, 9), 9)
        self.assertAlmostEqual(ease("ease_in", 0.5), 0.25)
        self.assertAlmostEqual(ease("ease_out", 0.5), 0.75)

    def test_ducking_ramps_before_and_after_speech_and_bridges_short_pauses(self) -> None:
        ramp = VIDEO_PROJECT_DUCK_RAMP_SECONDS
        spans = [(2.0, 3.0), (3.2, 4.0)]
        self.assertEqual(duck_level(spans, 0.25, 1.0), 1.0)
        self.assertAlmostEqual(duck_level(spans, 0.25, 2.0 - ramp / 2), 0.625)
        self.assertEqual(duck_level(spans, 0.25, 2.5), 0.25)
        self.assertEqual(duck_level(spans, 0.25, 3.1), 0.25)
        self.assertAlmostEqual(duck_level(spans, 0.25, 4.0 + ramp / 2), 0.625)


class ValidationTests(unittest.TestCase):
    def test_keyframes_must_be_ordered_and_in_range(self) -> None:
        with self.assertRaises(ValidationError):
            VideoProjectKeyframes(x=[key(1, 0), key(0.5, 0)])
        with self.assertRaises(ValidationError):
            VideoProjectKeyframes(opacity=[key(0, 1.5)])
        with self.assertRaises(ValidationError):
            still_clip(1, keyframes=VideoProjectKeyframes(gain=[key(0, 1)]))
        with self.assertRaises(ValidationError):
            still_clip(1, keyframes=VideoProjectKeyframes(bass=[key(0, 3)]))
        with self.assertRaises(ValidationError):
            VideoProjectKeyframes(treble=[key(0, 13)])
        with self.assertRaises(ValidationError):
            audio_clip("a", "a1", "x.wav", 0, 1, keyframes=VideoProjectKeyframes(x=[key(0, 0)]))

    def test_sound_overlaps_its_next_neighbour_but_never_covers_a_clip_or_stacks_three(
        self,
    ) -> None:
        with TempMediaFolder() as root:
            write_sine(root, "tone.wav", 0.1, 440, 4)

            def build(*spans: tuple[float, float]) -> VideoProject:
                return make_project(
                    root,
                    ["tone.wav"],
                    [
                        audio_clip(f"c{index}", "a1", "tone.wav", start, end - start)
                        for index, (start, end) in enumerate(spans)
                    ],
                )

            build((0, 2), (1, 3))
            with self.assertRaisesRegex(ValidationError, "covers"):
                build((0, 3), (1, 2))
            with self.assertRaisesRegex(ValidationError, "Three"):
                build((0, 2), (1, 3), (1.5, 3.5))


class PictureAnimationTests(unittest.TestCase):
    def render(self, root: Path, clip: VideoProjectClip) -> list[bytes]:
        write_still(root, "white.png", WHITE)
        edit = make_project(root, ["white.png"], [clip])
        return frames(render_small(root, edit))

    def test_position_follows_its_keyframes_frame_by_frame(self) -> None:
        keys = [key(0, -0.25), key(1, 0.25, "ease_out")]
        with TempMediaFolder() as root:
            shown = self.render(
                root,
                still_clip(
                    1.5,
                    transform=VideoProjectTransform(scale=0.2),
                    keyframes=VideoProjectKeyframes(x=keys),
                ),
            )
        self.assertEqual(len(shown), 36)
        for index, frame in enumerate(shown):
            centre_x, centre_y, _, _ = lit_box(frame)
            expected = WIDTH / 2 + WIDTH * keyframe_value(keys, index / RATE, 0)
            self.assertAlmostEqual(centre_x, expected, delta=1.5, msg=f"frame {index}")
            self.assertAlmostEqual(centre_y, HEIGHT / 2, delta=1.5)

    def test_scale_follows_its_keyframes_frame_by_frame(self) -> None:
        keys = [key(0, 0.2, "ease_in_out"), key(1, 0.6)]
        with TempMediaFolder() as root:
            shown = self.render(root, still_clip(1.25, keyframes=VideoProjectKeyframes(scale=keys)))
        for index, frame in enumerate(shown):
            centre_x, centre_y, width, height = lit_box(frame)
            scale = keyframe_value(keys, index / RATE, 1)
            self.assertAlmostEqual(width, round(WIDTH * scale), delta=2, msg=f"frame {index}")
            self.assertAlmostEqual(height, round(HEIGHT * scale), delta=2, msg=f"frame {index}")
            self.assertAlmostEqual(centre_x, WIDTH / 2, delta=1.5)
            self.assertAlmostEqual(centre_y, HEIGHT / 2, delta=1.5)

    def test_rotation_turns_the_layer_and_then_holds(self) -> None:
        keys = [key(0, 0), key(0.5, 90)]
        with TempMediaFolder() as root:
            shown = self.render(
                root,
                still_clip(
                    1,
                    transform=VideoProjectTransform(scale=0.3),
                    keyframes=VideoProjectKeyframes(rotation=keys),
                ),
            )
        _, _, width, height = lit_box(shown[0])
        self.assertAlmostEqual(width, 96, delta=2)
        self.assertAlmostEqual(height, 54, delta=2)
        for frame in shown[12:]:
            _, _, width, height = lit_box(frame)
            self.assertAlmostEqual(width, 54, delta=2)
            self.assertAlmostEqual(height, 96, delta=2)

    def test_opacity_follows_its_keyframes_and_multiplies_the_fades(self) -> None:
        keys = [key(0, 0), key(1, 1, "hold"), key(1.5, 0.5)]
        with TempMediaFolder() as root:
            shown = self.render(
                root,
                still_clip(2, fade_out=0.5, keyframes=VideoProjectKeyframes(opacity=keys)),
            )
        centre = (HEIGHT // 2) * WIDTH + WIDTH // 2
        for index, frame in enumerate(shown):
            time = index / RATE
            fade = min(1.0, (2 - time) / 0.5)
            expected = 255 * keyframe_value(keys, time, 1) * fade
            self.assertAlmostEqual(frame[centre], expected, delta=4, msg=f"frame {index}")

    def test_a_title_moves_and_scales_like_any_layer(self) -> None:
        with TempMediaFolder() as root:
            edit = make_project(
                root,
                [],
                [
                    VideoProjectClip(
                        id="title",
                        track_id="v1",
                        kind="title",
                        start=0,
                        duration=0.5,
                        title=VideoProjectTitle(text="I", size=0.4),
                        transform=VideoProjectTransform(x=0.25, scale=0.5),
                    )
                ],
            )
            plain = make_project(
                root,
                [],
                [edit.clips[0].model_copy(update={"transform": VideoProjectTransform()})],
            )
            moved = lit_box(frames(render_small(root, edit))[0])
            centred = lit_box(frames(render_small(root, plain))[0])
        self.assertAlmostEqual(moved[0], WIDTH / 2 + (centred[0] - WIDTH / 2) / 2 + 80, delta=2)
        self.assertAlmostEqual(moved[3], centred[3] / 2, delta=2)


class MixTests(unittest.TestCase):
    def render(self, root: Path, edit: VideoProject) -> list[float]:
        return samples(render_small(root, edit, audio_level="unchanged"))

    def test_a_gain_envelope_follows_its_keyframes(self) -> None:
        keys = [key(0, 0), key(1, 1), key(1.5, 0.5, "hold")]
        with TempMediaFolder() as root:
            write_sine(root, "tone.wav", 0.4, 997, 2)
            sound = self.render(
                root,
                make_project(
                    root,
                    ["tone.wav"],
                    [
                        spacer(2),
                        audio_clip(
                            "tone",
                            "a1",
                            "tone.wav",
                            0,
                            2,
                            keyframes=VideoProjectKeyframes(gain=keys),
                        ),
                    ],
                ),
            )
        full = 0.4 / math.sqrt(2)
        for at in (0.25, 0.5, 0.75, 1.25, 1.75):
            expected = full * keyframe_value(keys, at, 1)
            self.assertAlmostEqual(rms(sound, at, 0.02), expected, delta=0.02, msg=f"at {at}")

    def test_eq_bands_follow_their_keyframes(self) -> None:
        # The mid band peaks at exactly its gain on its own frequency.
        keys = [key(0, 0), key(1, 12), key(1.5, -6, "hold")]
        with TempMediaFolder() as root:
            write_sine(root, "tone.wav", 0.1, round(AUDIO_EQ_MID_HZ), 2)
            sound = self.render(
                root,
                make_project(
                    root,
                    ["tone.wav"],
                    [
                        spacer(2),
                        audio_clip(
                            "tone",
                            "a1",
                            "tone.wav",
                            0,
                            2,
                            audio_effects=AudioEffects(mid=-12),
                            keyframes=VideoProjectKeyframes(mid=keys),
                        ),
                    ],
                ),
            )
        full = 0.1 / math.sqrt(2)
        for at in (0.25, 0.5, 0.75, 1.25, 1.75):
            expected = full * 10 ** (keyframe_value(keys, at, 0) / 20)
            self.assertAlmostEqual(
                rms(sound, at, 0.02), expected, delta=expected * 0.05, msg=f"at {at}"
            )

    def test_an_overlap_on_one_track_crossfades_at_equal_power(self) -> None:
        with TempMediaFolder() as root:
            write_sine(root, "low.wav", 0.3, 440, 3)
            write_sine(root, "high.wav", 0.3, 1250, 3)
            sound = self.render(
                root,
                make_project(
                    root,
                    ["low.wav", "high.wav"],
                    [
                        spacer(3),
                        audio_clip("low", "a1", "low.wav", 0, 2),
                        audio_clip("high", "a1", "high.wav", 1, 2),
                    ],
                ),
            )
        steady = rms(sound, 0.5)
        self.assertAlmostEqual(steady, 0.3 / math.sqrt(2), delta=0.01)
        for at in (1.2, 1.5, 1.8):
            self.assertAlmostEqual(rms(sound, at), steady, delta=steady * 0.08, msg=f"at {at}")

    def test_track_and_master_gains_multiply_the_mix(self) -> None:
        with TempMediaFolder() as root:
            write_sine(root, "tone.wav", 0.4, 997, 1)
            sound = self.render(
                root,
                make_project(
                    root,
                    ["tone.wav"],
                    [spacer(1), audio_clip("tone", "a2", "tone.wav", 0, 1)],
                    tracks=tracks(a2={"gain": 0.5}),
                    mix=VideoProjectMix(master_gain=1.5),
                ),
            )
        self.assertAlmostEqual(rms(sound, 0.5), 0.4 / math.sqrt(2) * 0.75, delta=0.01)

    def test_other_tracks_duck_while_speech_sounds(self) -> None:
        with TempMediaFolder() as root:
            write_sine(root, "music.wav", 0.4, 440, 4)
            # The speech itself is silent, so only the music is measured.
            write_sine(root, "speech.wav", 0, 440, 1)
            spans = [(1.5, 2.5)]
            sound = self.render(
                root,
                make_project(
                    root,
                    ["music.wav", "speech.wav"],
                    [
                        spacer(4),
                        audio_clip("speech", "a1", "speech.wav", 1.5, 1),
                        audio_clip("music", "a2", "music.wav", 0, 4),
                    ],
                    tracks=tracks(a1={"speech": True}),
                    mix=VideoProjectMix(duck_gain=0.25),
                ),
            )
        full = 0.4 / math.sqrt(2)
        for at in (0.5, 1.35, 2.0, 2.65, 3.5):
            expected = full * duck_level(spans, 0.25, at)
            self.assertAlmostEqual(rms(sound, at, 0.02), expected, delta=0.02, msg=f"at {at}")


if __name__ == "__main__":
    unittest.main()
