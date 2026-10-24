from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import mutagen
from pydantic import ValidationError

import audio_edit
import edit_sidecars
from audio_effects import AudioProbe, probe_audio
from audio_level import build_file_measure, parse_loudness
from constants import VIDEO_PROJECT_LOUDNESS_TARGET_LUFS
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import run_ffmpeg
from schemas import AudioEditSpec, AudioEffects, VideoEditSpec
from testing_fixtures import (
    CacheFolderTestCase,
    TempMediaFolder,
    write_edit_spec,
    write_mp4_video,
)


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


def tone(root: Path, name: str, *output: str, seconds: float = 3.0, amplitude: float = 0.1):
    return generate(
        root,
        name,
        *("-f", "lavfi", "-i", f"aevalsrc={amplitude}*sin(2*PI*440*t):s=44100:d={seconds}"),
        *output,
    )


class SpecTests(unittest.TestCase):
    def test_a_same_stem_video_edit_is_not_read_as_an_audio_edit(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")
            write_edit_spec(video, VideoEditSpec(trim_start=1.0, volume=0.5))

            self.assertIsNone(audio_edit.read_audio_edit_spec(root / "clip.wav"))

    def test_fades_longer_than_the_kept_sound_are_refused(self) -> None:
        with self.assertRaises(ValidationError):
            AudioEditSpec(trim_start=1, trim_end=2, speed=2, fade_in=0.3, fade_out=0.3)
        AudioEditSpec(trim_start=1, trim_end=2, speed=2, fade_in=0.25, fade_out=0.25)

    def test_a_cut_outside_its_range_is_refused(self) -> None:
        with self.assertRaises(ValidationError):
            AudioEffects(low_cut=5)
        with self.assertRaises(ValidationError):
            AudioEffects(high_cut=900)

    def test_only_a_change_counts_as_an_edit(self) -> None:
        self.assertTrue(audio_edit.is_identity_spec(AudioEditSpec()))
        for change in (
            {"trim_start": 0.5},
            {"fade_out": 1.0},
            {"volume": 0.5},
            {"level": "limit"},
            {"speed": 1.5},
            {"pitch": -2},
            {"effects": AudioEffects(bass=3)},
        ):
            with self.subTest(change=change):
                self.assertFalse(audio_edit.is_identity_spec(AudioEditSpec(**change)))


class FilterTests(unittest.TestCase):
    def test_trim_runs_in_source_time_and_fades_in_output_time(self) -> None:
        spec = AudioEditSpec(
            trim_start=1,
            trim_end=5,
            speed=2,
            volume=1.5,
            fade_in=0.5,
            fade_out=1,
            effects=AudioEffects(mid=3),
        )
        filters = audio_edit.build_audio_filters(spec, audio_edit.expected_output_seconds(spec, 9))

        self.assertEqual(
            [name.partition("=")[0] for name in filters],
            ["atrim", "asetpts", "atempo", "equalizer", "volume", "afade", "afade"],
        )
        self.assertEqual(filters[0], "atrim=start=1.000000:end=5.000000")
        # Four source seconds at double speed are two output seconds: the fade starts at one.
        self.assertIn("st=1.000000:d=1.000000", filters[-1])
        self.assertIn("curve=qsin", filters[-1])

    def test_an_untrimmed_fade_out_ends_with_the_file(self) -> None:
        spec = AudioEditSpec(fade_out=2, fade_curve="linear")
        filters = audio_edit.build_audio_filters(spec, audio_edit.expected_output_seconds(spec, 10))
        self.assertEqual(filters, ["afade=t=out:st=8.000000:d=2.000000:curve=tri"])

    def test_the_level_stage_comes_last(self) -> None:
        filters = audio_edit.build_audio_filters(
            AudioEditSpec(volume=0.5), 3, level=["alimiter=limit=0.9"]
        )
        self.assertEqual(filters, ["volume=0.500000", "alimiter=limit=0.9"])


class EncoderTests(unittest.TestCase):
    def test_a_wav_keeps_its_sample_format(self) -> None:
        arguments = audio_edit.encoder_arguments(
            "wav", AudioProbe(codec="pcm_f32le", sample_rate=96000)
        )
        self.assertEqual(arguments, ["-c:a", "pcm_f32le", "-ar", "96000"])

    def test_a_flac_keeps_sixteen_bits_or_writes_twenty_four(self) -> None:
        self.assertIn("s16", audio_edit.encoder_arguments("flac", AudioProbe(sample_format="s16")))
        self.assertIn("s32", audio_edit.encoder_arguments("flac", AudioProbe(sample_format="s32")))

    def test_an_mp3_snaps_its_bitrate_to_one_lame_can_write(self) -> None:
        arguments = audio_edit.encoder_arguments("mp3", AudioProbe(kbps=187))
        self.assertEqual(arguments[arguments.index("-b:a") + 1], "192k")
        fallback = audio_edit.encoder_arguments("mp3", AudioProbe())
        self.assertIn("-q:a", fallback)

    def test_a_proxy_source_takes_its_tags_and_cover_from_the_original(self) -> None:
        command = audio_edit.build_audio_edit_command(
            Path("proxy.flac"),
            Path("out"),
            [],
            executable="ffmpeg",
            muxer="mp3",
            probe=AudioProbe(kbps=128, has_picture=True),
            tagged=Path("song.mp3.bak"),
        )
        joined = " ".join(command)
        self.assertIn("-i proxy.flac -i song.mp3.bak", joined)
        self.assertIn("-map 0:a:0 -map_metadata 1 -map 1:v? -c:v copy", joined)


class ApplyAudioEditTests(CacheFolderTestCase):
    """Real ffmpeg: what each format keeps, and that the original comes back."""

    def test_a_wav_is_trimmed_in_its_own_format_and_reverts_byte_identical(self) -> None:
        with TempMediaFolder() as root:
            media = tone(root, "voice.wav", "-c:a", "pcm_s24le")
            original = media.read_bytes()

            response = audio_edit.apply_audio_edit(
                media, AudioEditSpec(trim_start=0.5, trim_end=2.0, fade_in=0.2, fade_out=0.2)
            )

            self.assertTrue(response.has_backup)
            self.assertAlmostEqual(response.duration or 0, 1.5, delta=0.01)
            probe = probe_audio(ffmpeg(), media)
            self.assertEqual((probe.codec, probe.sample_rate), ("pcm_s24le", 44100))
            spec = audio_edit.read_audio_edit_spec(media)
            self.assertEqual(spec.trim_end if spec else None, 2.0)

            audio_edit.revert_audio_edit(media)
            self.assertEqual(media.read_bytes(), original)
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())

    def test_a_re_edit_starts_from_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = tone(root, "voice.wav")
            audio_edit.apply_audio_edit(media, AudioEditSpec(trim_end=1.0))
            response = audio_edit.apply_audio_edit(media, AudioEditSpec(trim_end=2.0))
            self.assertAlmostEqual(response.duration or 0, 2.0, delta=0.01)

    def test_a_flac_keeps_its_depth_and_its_tags(self) -> None:
        with TempMediaFolder() as root:
            media = tone(
                root, "take.flac", "-c:a", "flac", "-sample_fmt", "s32", "-metadata", "title=Take"
            )

            audio_edit.apply_audio_edit(media, AudioEditSpec(effects=AudioEffects(treble=3)))

            self.assertEqual(probe_audio(ffmpeg(), media).bits, 24)
            self.assertEqual(mutagen.File(media)["title"], ["Take"])

    def test_an_mp3_keeps_its_bitrate_and_tags(self) -> None:
        with TempMediaFolder() as root:
            media = tone(
                root, "song.mp3", "-c:a", "libmp3lame", "-b:a", "160k", "-metadata", "title=Song"
            )

            audio_edit.apply_audio_edit(media, AudioEditSpec(volume=0.5))

            self.assertEqual(probe_audio(ffmpeg(), media).kbps, 160)
            self.assertEqual(str(mutagen.File(media)["TIT2"]), "Song")

    def test_normalize_brings_the_sound_to_the_target(self) -> None:
        with TempMediaFolder() as root:
            media = tone(root, "quiet.wav", amplitude=0.02)

            audio_edit.apply_audio_edit(media, AudioEditSpec(level="normalize"))

            loudness = parse_loudness(run_ffmpeg(build_file_measure(ffmpeg(), media)))
            assert loudness is not None
            self.assertAlmostEqual(
                loudness.integrated_lufs, VIDEO_PROJECT_LOUDNESS_TARGET_LUFS, delta=0.5
            )

    def test_noise_reduction_and_pitch_are_rendered_from_the_proxy(self) -> None:
        """The proxy is what the preview played, so the file must be made from the same one."""
        with TempMediaFolder() as root:
            media = tone(root, "voice.wav")
            with patch("audio_edit.audio_proxy", wraps=audio_edit.audio_proxy) as proxy:
                audio_edit.apply_audio_edit(
                    media, AudioEditSpec(pitch=2, effects=AudioEffects(noise_reduction=0.4))
                )

            proxy.assert_called_once()
            self.assertEqual(proxy.call_args.args[1], edit_sidecars.backup_path_for(media))
            self.assertEqual(proxy.call_args.kwargs, {"noise_reduction": 0.4, "pitch": 2})

    def test_a_failed_render_leaves_the_file_as_it_was(self) -> None:
        with TempMediaFolder() as root:
            media = tone(root, "voice.wav")
            before = media.read_bytes()
            with (
                patch("audio_edit.run_ffmpeg", side_effect=RuntimeError("boom")),
                self.assertRaises(RuntimeError),
            ):
                audio_edit.apply_audio_edit(media, AudioEditSpec(volume=0.5))

            self.assertEqual(media.read_bytes(), before)
            self.assertFalse(edit_sidecars.edit_spec_path(media).exists())


if __name__ == "__main__":
    unittest.main()
