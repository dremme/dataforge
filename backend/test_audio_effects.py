from __future__ import annotations

import cmath
import math
import subprocess
import unittest
from pathlib import Path

import numpy as np

from audio_effects import (
    audio_proxy,
    denoise_delay,
    eq_filters,
    is_effects_identity,
    parse_audio_probe,
    pitch_filters,
    pitch_ratio,
    probe_audio,
    quiet_stretch,
)
from constants import (
    AUDIO_EQ_BASS_HZ,
    AUDIO_EQ_MID_HZ,
    AUDIO_EQ_MID_Q,
    AUDIO_EQ_TREBLE_HZ,
    AUDIO_NOISE_REDUCTION_MAX_DB,
)
from ffmpeg_bin import ffmpeg_path
from schemas import AudioEffects
from testing_fixtures import CacheFolderTestCase, TempMediaFolder

RATE = 48000


def ffmpeg() -> str:
    executable = ffmpeg_path()
    assert executable
    return executable


def decode(media: Path, *arguments: str) -> np.ndarray:
    """Mono float samples of the first sound stream, after ``arguments`` as output options."""
    out = subprocess.run(
        [ffmpeg(), "-v", "error", "-i", str(media), *arguments, "-ac", "1", "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(out, dtype="<f4").astype(np.float64)


def db(samples: np.ndarray) -> float:
    return 20 * math.log10(math.sqrt(float(np.mean(samples**2))) + 1e-12)


def write_samples(root: Path, name: str, samples: np.ndarray, rate: int = RATE) -> Path:
    raw = root / f"{name}.raw"
    samples.astype("<f4").tofile(raw)
    media = root / name
    subprocess.run(
        [
            ffmpeg(),
            "-v",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ar",
            str(rate),
            "-ac",
            "1",
            "-i",
            str(raw),
            "-c:a",
            "pcm_f32le",
            str(media),
        ],
        check=True,
        capture_output=True,
    )
    raw.unlink()
    return media


def rbj_gain_db(kind: str, frequency: float, corner: float, gain: float = 0.0) -> float:
    """The RBJ cookbook response the browser's BiquadFilterNode draws for the same settings:
    Butterworth cuts, shelves at slope 1, a peak at a linear Q."""
    w0 = 2 * math.pi * corner / RATE
    cos, sin = math.cos(w0), math.sin(w0)
    a = 10 ** (gain / 40)
    if kind in ("highpass", "lowpass"):
        alpha = sin / (2 * (1 / math.sqrt(2)))
        sign = 1 if kind == "lowpass" else -1
        b = [(1 - sign * cos) / 2, sign * (1 - sign * cos), (1 - sign * cos) / 2]
        den = [1 + alpha, -2 * cos, 1 - alpha]
    elif kind == "peaking":
        alpha = sin / (2 * AUDIO_EQ_MID_Q)
        b = [1 + alpha * a, -2 * cos, 1 - alpha * a]
        den = [1 + alpha / a, -2 * cos, 1 - alpha / a]
    else:
        alpha = sin / 2 * math.sqrt(2)
        root = 2 * math.sqrt(a) * alpha
        s = 1 if kind == "lowshelf" else -1
        b = [
            a * ((a + 1) - s * (a - 1) * cos + root),
            s * 2 * a * ((a - 1) - s * (a + 1) * cos),
            a * ((a + 1) - s * (a - 1) * cos - root),
        ]
        den = [
            (a + 1) + s * (a - 1) * cos + root,
            -s * 2 * ((a - 1) + s * (a + 1) * cos),
            (a + 1) + s * (a - 1) * cos - root,
        ]
    z = cmath.exp(-1j * 2 * math.pi * frequency / RATE)
    response = (b[0] + b[1] * z + b[2] * z * z) / (den[0] + den[1] * z + den[2] * z * z)
    return 20 * math.log10(abs(response))


class EqFilterTests(unittest.TestCase):
    def test_resting_effects_add_no_filters(self) -> None:
        self.assertEqual(eq_filters(AudioEffects()), [])
        self.assertTrue(is_effects_identity(AudioEffects()))
        self.assertFalse(is_effects_identity(AudioEffects(noise_reduction=0.2)))

    def test_bands_run_low_to_high(self) -> None:
        names = [
            name.partition("=")[0]
            for name in eq_filters(
                AudioEffects(low_cut=80, high_cut=12000, bass=3, mid=-2, treble=4)
            )
        ]
        self.assertEqual(names, ["highpass", "lowshelf", "equalizer", "highshelf", "lowpass"])

    def test_ffmpeg_draws_the_curves_the_browser_does(self) -> None:
        """A sine through each band is measured against the RBJ response of the same settings,
        which is what the preview's BiquadFilterNode plays."""
        cases = [
            (AudioEffects(low_cut=200), "highpass", 200.0, 0.0, [50, 200, 1000]),
            (AudioEffects(high_cut=4000), "lowpass", 4000.0, 0.0, [1000, 4000, 12000]),
            (AudioEffects(bass=9), "lowshelf", AUDIO_EQ_BASS_HZ, 9.0, [40, 120, 1000]),
            (AudioEffects(mid=-10), "peaking", AUDIO_EQ_MID_HZ, -10.0, [300, 1000, 3000]),
            (AudioEffects(treble=6), "highshelf", AUDIO_EQ_TREBLE_HZ, 6.0, [1000, 6000, 15000]),
        ]
        for effects, kind, corner, gain, frequencies in cases:
            for frequency in frequencies:
                with self.subTest(kind=kind, frequency=frequency):
                    sine = (
                        f"sine=frequency={frequency}:sample_rate={RATE}:duration=1,"
                        f"{','.join(eq_filters(effects))}"
                    )
                    out = subprocess.run(
                        [ffmpeg(), "-v", "error", "-f", "lavfi", "-i", sine, "-f", "f32le", "-"],
                        capture_output=True,
                        check=True,
                    ).stdout
                    samples = np.frombuffer(out, dtype="<f4").astype(np.float64)
                    measured = db(samples[RATE // 2 :]) - db_of_unit_sine()
                    expected = rbj_gain_db(kind, frequency, corner, gain)
                    self.assertAlmostEqual(measured, expected, delta=0.2)


def db_of_unit_sine() -> float:
    """ffmpeg's ``sine`` source plays at 1/8 of full scale."""
    return 20 * math.log10(0.125 / math.sqrt(2))


class ProbeTests(unittest.TestCase):
    def test_a_pcm_wav_names_its_codec_rate_and_format(self) -> None:
        summary = (
            "  Duration: 00:01:02.50, bitrate: 1536 kb/s\n"
            "  Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s32"
            " (24 bit), 2304 kb/s\n"
        )
        probe = parse_audio_probe(summary)
        self.assertEqual(probe.codec, "pcm_s24le")
        self.assertEqual(probe.sample_rate, 48000)
        self.assertEqual(probe.sample_format, "s32")
        self.assertEqual(probe.bits, 24)
        self.assertEqual(probe.kbps, 2304)
        self.assertEqual(probe.duration, 62.5)
        self.assertFalse(probe.has_picture)

    def test_an_mp3_with_a_cover_reports_its_bitrate_and_picture(self) -> None:
        summary = (
            "  Duration: 00:00:03.03, start: 0.025057, bitrate: 196 kb/s\n"
            "  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 192 kb/s\n"
            "  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 300x300, 90k tbr (attached pic)\n"
        )
        probe = parse_audio_probe(summary)
        self.assertEqual(probe.codec, "mp3")
        self.assertEqual(probe.kbps, 192)
        self.assertTrue(probe.has_picture)

    def test_a_file_without_sound_reports_nothing_about_it(self) -> None:
        probe = parse_audio_probe("  Stream #0:0: Video: h264, yuv420p, 64x48\n")
        self.assertIsNone(probe.sample_rate)


class PitchTests(unittest.TestCase):
    def test_the_ratio_is_what_a_whole_sample_rate_allows(self) -> None:
        self.assertEqual(pitch_ratio(12, 44100), 2.0)
        self.assertAlmostEqual(pitch_ratio(1, 44100) * 44100, round(44100 * 2 ** (1 / 12)))

    def test_no_move_adds_no_filters(self) -> None:
        self.assertEqual(pitch_filters(0, 48000), [])

    def test_a_move_retimes_back_to_the_same_length(self) -> None:
        filters = pitch_filters(-12, 48000)
        self.assertEqual(filters[:2], ["asetrate=24000", "aresample=48000"])
        self.assertEqual(filters[2], "atempo=2.000000")


def tone_over_hiss(seconds: float = 6.0, rate: int = RATE) -> np.ndarray:
    """Hiss throughout at -40 dBFS, a tone every other second from 1 s, and a click at 4.5 s."""
    t = np.arange(round(rate * seconds)) / rate
    tone = 0.3 * np.sin(2 * np.pi * 440 * t) * ((t % 2) >= 1)
    samples = tone + np.random.default_rng(7).normal(0, 0.01, t.size)
    if seconds > 4.5:
        samples[round(rate * 4.5)] += 0.6
    return samples


class ProxyTests(CacheFolderTestCase):
    def test_noise_reduction_learns_the_quiet_stretch_and_reduces_by_its_strength(self) -> None:
        with TempMediaFolder() as root:
            samples = tone_over_hiss()
            media = write_samples(root, "hiss.wav", samples)

            start, length = quiet_stretch(ffmpeg(), media, RATE)
            # Inside one of the seconds the tone leaves to the hiss.
            self.assertEqual(int(start / RATE), int((start + length) / RATE))
            self.assertEqual(int(start / RATE) % 2, 0)

            proxy = decode(audio_proxy(ffmpeg(), media, noise_reduction=0.8))

        gap = slice(round(RATE * 2.2), round(RATE * 2.8))
        tone = slice(round(RATE * 3.2), round(RATE * 3.8))
        reduced = db(samples[gap]) - db(proxy[gap])
        self.assertAlmostEqual(reduced, 0.8 * AUDIO_NOISE_REDUCTION_MAX_DB, delta=1.5)
        self.assertAlmostEqual(db(proxy[tone]), db(samples[tone]), delta=0.1)

    def test_a_noise_reduced_proxy_keeps_the_sound_in_place_to_the_sample(self) -> None:
        """afftdn delays by about 25 ms; uncorrected, the editor's sound would trail its picture."""
        for rate in (44100, 48000):
            with self.subTest(rate=rate), TempMediaFolder() as root:
                samples = tone_over_hiss(rate=rate)
                media = write_samples(root, "hiss.wav", samples, rate)

                proxy = decode(audio_proxy(ffmpeg(), media, noise_reduction=0.5))

                self.assertGreater(denoise_delay(ffmpeg(), rate), 0)
                self.assertEqual(proxy.size, samples.size)
                window = slice(round(rate * 4.4), round(rate * 4.6))
                self.assertEqual(
                    int(np.argmax(np.abs(proxy[window]))),
                    int(np.argmax(np.abs(samples[window]))),
                )

    def test_a_pitch_move_lands_on_the_new_note_at_about_the_same_length(self) -> None:
        with TempMediaFolder() as root:
            t = np.arange(RATE * 2) / RATE
            media = write_samples(root, "a.wav", 0.5 * np.sin(2 * np.pi * 440 * t))

            proxy = decode(audio_proxy(ffmpeg(), media, noise_reduction=0, pitch=7))

        spectrum = np.abs(np.fft.rfft(proxy[RATE // 2 : RATE // 2 + RATE]))
        self.assertAlmostEqual(float(np.argmax(spectrum)), 440 * 2 ** (7 / 12), delta=2)
        self.assertAlmostEqual(proxy.size / RATE, 2.0, delta=0.02)

    def test_a_proxy_is_cached_per_setting_and_rebuilt_when_the_source_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_samples(root, "hiss.wav", tone_over_hiss(seconds=2))

            first = audio_proxy(ffmpeg(), media, noise_reduction=0.5)
            self.assertEqual(audio_proxy(ffmpeg(), media, noise_reduction=0.5), first)
            self.assertNotEqual(audio_proxy(ffmpeg(), media, noise_reduction=0.6), first)

            write_samples(root, "hiss.wav", tone_over_hiss(seconds=3))
            rebuilt = audio_proxy(ffmpeg(), media, noise_reduction=0.5)

            self.assertNotEqual(rebuilt, first)
            self.assertAlmostEqual(probe_audio(ffmpeg(), rebuilt).duration or 0, 3.0, delta=0.01)

    def test_a_sound_that_needs_nothing_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_samples(root, "hiss.wav", tone_over_hiss(seconds=1))
            with self.assertRaises(ValueError):
                audio_proxy(ffmpeg(), media, noise_reduction=0)


if __name__ == "__main__":
    unittest.main()
