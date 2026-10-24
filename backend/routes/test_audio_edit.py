from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from urllib.parse import quote

import edit_sidecars
from constants import VIDEO_PROJECT_LOUDNESS_TARGET_LUFS
from ffmpeg_bin import ffmpeg_path
from routes._test_client import client
from schemas import AudioEditSpec
from testing_fixtures import (
    CacheFolderTestCase,
    TempMediaFolder,
    write_edit_spec,
    write_image,
    write_wav,
)

EDIT_URL = "/api/media/audio-edit"
PROXY_URL = "/api/media/audio-proxy"


def url(base: str, media: Path, suffix: str = "", **params: str) -> str:
    query = "".join(f"&{key}={quote(value)}" for key, value in params.items())
    return f"{base}{suffix}?path={quote(str(media))}{query}"


def hiss(root: Path, name: str = "room.wav", seconds: float = 2.0) -> Path:
    media = root / name
    executable = ffmpeg_path()
    assert executable
    subprocess.run(
        [
            executable,
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"anoisesrc=a=0.02:d={seconds}:r=48000",
            str(media),
        ],
        check=True,
        capture_output=True,
    )
    return media


class AudioEditStateTests(unittest.TestCase):
    def test_an_unedited_file_reports_its_length_and_no_spec(self) -> None:
        with TempMediaFolder() as root:
            media = write_wav(root, "voice.wav", seconds=1.5)

            payload = client.get(url(EDIT_URL, media)).json()

            self.assertFalse(payload["has_backup"])
            self.assertIsNone(payload["spec"])
            self.assertAlmostEqual(payload["duration"], 1.5, places=2)

    def test_an_edited_file_reports_its_spec_and_the_original_length(self) -> None:
        with TempMediaFolder() as root:
            media = write_wav(root, "voice.wav", seconds=1.0)
            write_wav(root, "original.wav", seconds=3.0).replace(
                edit_sidecars.backup_path_for(media)
            )
            write_edit_spec(media, AudioEditSpec(trim_end=1.0))

            payload = client.get(url(EDIT_URL, media)).json()

            self.assertTrue(payload["has_backup"])
            self.assertEqual(payload["spec"]["trim_end"], 1.0)
            self.assertAlmostEqual(payload["duration"], 3.0, places=2)

    def test_a_video_is_not_edited_as_audio(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "still.png")
            self.assertEqual(client.get(url(EDIT_URL, media)).status_code, 400)


class AudioEditApplyTests(CacheFolderTestCase):
    def test_an_edit_that_changes_nothing_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_wav(root, "voice.wav")
            response = client.post(url(EDIT_URL, media), json={})
            self.assertEqual(response.status_code, 400)

    def test_an_edit_is_applied_and_reverted(self) -> None:
        with TempMediaFolder() as root:
            media = write_wav(root, "voice.wav", seconds=2.0)
            original = media.read_bytes()

            applied = client.post(url(EDIT_URL, media), json={"trim_end": 1.0, "fade_out": 0.2})
            self.assertEqual(applied.status_code, 200, applied.text)
            self.assertAlmostEqual(applied.json()["duration"], 1.0, places=2)
            self.assertTrue(applied.json()["has_backup"])

            reverted = client.post(url(EDIT_URL, media, "/revert"))
            self.assertEqual(reverted.status_code, 200, reverted.text)
            self.assertEqual(media.read_bytes(), original)

    def test_reverting_an_unedited_file_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_wav(root, "voice.wav")
            self.assertEqual(client.post(url(EDIT_URL, media, "/revert")).status_code, 400)

    def test_loudness_is_measured_as_the_spec_shapes_it(self) -> None:
        with TempMediaFolder() as root:
            media = write_wav(root, "voice.wav")

            plain = client.post(url(EDIT_URL, media, "/loudness"), json={}).json()
            halved = client.post(url(EDIT_URL, media, "/loudness"), json={"volume": 0.5}).json()

            self.assertLess(plain["integrated_lufs"], 0)
            self.assertGreater(plain["integrated_lufs"], VIDEO_PROJECT_LOUDNESS_TARGET_LUFS - 20)
            self.assertAlmostEqual(
                plain["integrated_lufs"] - halved["integrated_lufs"], 6.02, delta=0.1
            )


class AudioProxyRouteTests(CacheFolderTestCase):
    def test_a_proxy_is_prepared_then_served_as_flac(self) -> None:
        with TempMediaFolder() as root:
            media = hiss(root)

            prepared = client.post(url(PROXY_URL, media, noise_reduction="0.5"))
            self.assertEqual(prepared.status_code, 204, prepared.text)
            served = client.get(url(PROXY_URL, media, noise_reduction="0.5", v="1"))

            self.assertEqual(served.status_code, 200)
            self.assertEqual(served.headers["content-type"], "audio/flac")
            self.assertTrue(served.content.startswith(b"fLaC"))
            self.assertIn("immutable", served.headers["cache-control"])

    def test_a_sound_that_needs_no_proxy_and_a_file_without_sound_are_refused(self) -> None:
        with TempMediaFolder() as root:
            media = hiss(root)
            still = write_image(root, "still.png")

            self.assertEqual(client.get(url(PROXY_URL, media)).status_code, 400)
            self.assertEqual(
                client.get(url(PROXY_URL, still, noise_reduction="0.5")).status_code, 400
            )


if __name__ == "__main__":
    unittest.main()
