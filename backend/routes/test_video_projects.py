from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from ffmpeg_bin import ffmpeg_path
from routes._test_client import client
from testing_fixtures import TempMediaFolder, playable_video_bytes, write_image, write_wav
from video_project import new_empty_project, save_project
from video_project_index import known_draft_paths


def write_video(root: Path, name: str = "clip.mp4") -> Path:
    media = root / name
    media.write_bytes(playable_video_bytes(audio=True, duration=1))
    return media


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class ProjectEndpointTests(unittest.TestCase):
    def start(self, media: Path) -> dict:
        response = client.get(f"/api/video-projects/start?path={quote(str(media))}")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def save(self, root: Path, document: dict, path=None, base=None):
        return client.put(
            "/api/video-projects/project",
            json={
                "folder": str(root),
                "path": path,
                "base_revision": base,
                "project": document["project"],
            },
        )

    def test_a_project_saves_lists_reopens_and_deletes(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root)
            document = self.start(media)
            self.assertIsNone(document["path"])
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["clip.mp4"])

            saved = self.save(root, document).json()
            self.assertEqual(saved["revision"], 1)

            listing = client.get(f"/api/video-projects?folder={quote(str(root))}").json()
            self.assertEqual([p["path"] for p in listing["projects"]], [saved["path"]])

            reopened = client.get(f"/api/video-projects/project?path={quote(saved['path'])}")
            self.assertEqual(reopened.json()["project"]["revision"], 1)

            deleted = client.delete(f"/api/video-projects/project?path={quote(saved['path'])}")
            self.assertEqual(deleted.status_code, 204)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["clip.mp4"])

    def test_an_empty_project_opens_without_writing_anything(self) -> None:
        with TempMediaFolder() as root:
            response = client.get(f"/api/video-projects/new?folder={quote(str(root))}")

            self.assertEqual(response.status_code, 200, response.text)
            document = response.json()
            self.assertIsNone(document["path"])
            self.assertEqual(document["project"]["clips"], [])
            self.assertEqual(
                [track["name"] for track in document["project"]["tracks"]], ["V2", "V1", "A1", "A2"]
            )
            self.assertEqual(list(root.iterdir()), [])

    def test_a_save_over_a_newer_revision_is_a_conflict(self) -> None:
        with TempMediaFolder() as root:
            document = self.start(write_video(root))
            path = self.save(root, document).json()["path"]
            self.assertEqual(self.save(root, document, path, 1).status_code, 200)

            response = self.save(root, document, path, 1)

            self.assertEqual(response.status_code, 409)
            self.assertIn("another window", response.json()["detail"])

    def test_only_supported_videos_start_a_project(self) -> None:
        with TempMediaFolder() as root:
            picture = write_image(root, "still.png")
            other = root / "clip.mkv"
            other.write_bytes(b"x")

            for media in (picture, other):
                response = client.get(f"/api/video-projects/start?path={quote(str(media))}")
                self.assertEqual(response.status_code, 400)

    def test_a_source_probe_reports_what_adding_records(self) -> None:
        with TempMediaFolder() as root:
            sound = write_wav(root, "music.wav", seconds=2)

            payload = client.get(f"/api/video-projects/source?path={quote(str(sound))}").json()

            self.assertEqual(payload["kind"], "audio")
            self.assertAlmostEqual(payload["duration"], 2.0, places=1)

    def test_timeline_pictures_are_served(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root)
            query = f"path={quote(str(media))}"

            strip = client.get(f"/api/video-projects/filmstrip?{query}&end=1&count=3&height=32")
            wave = client.get(
                f"/api/video-projects/waveform?{query}&start=0.5&duration=1&width=400"
            )

            self.assertEqual(strip.status_code, 200, strip.text)
            self.assertEqual(strip.headers["content-type"], "image/webp")
            self.assertEqual(wave.status_code, 200, wave.text)


class TitleEndpointTests(unittest.TestCase):
    def test_a_title_renders_as_a_canvas_sized_png(self) -> None:
        spec = quote(json.dumps({"text": "Hello"}))

        response = client.get(f"/api/video-projects/title?width=320&height=180&spec={spec}")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"\x89PNG"))

    def test_a_malformed_title_is_refused(self) -> None:
        spec = quote(json.dumps({"color": "red"}))

        response = client.get(f"/api/video-projects/title?width=320&height=180&spec={spec}")

        self.assertEqual(response.status_code, 400)


class FontEndpointTests(unittest.TestCase):
    def test_installed_families_are_listed_with_their_styles(self) -> None:
        families = [("Display", ["Regular", "Bold"]), ("Mono", ["Regular"])]
        with patch("routes.video_projects.installed_families", return_value=families):
            response = client.get("/api/video-projects/fonts")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["families"],
            [
                {"family": "Display", "styles": ["Regular", "Bold"]},
                {"family": "Mono", "styles": ["Regular"]},
            ],
        )


class AutoAdjustEndpointTests(unittest.TestCase):
    def suggest(self, body: dict):
        return client.post("/api/video-projects/auto-adjust", json=body)

    def test_a_dim_still_is_brightened(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "dim.png", color=(40, 40, 40))

            response = self.suggest({"path": str(media)})

            self.assertEqual(response.status_code, 200, response.text)
            suggestion = response.json()["suggestion"]
            self.assertGreater(suggestion["exposure"] + suggestion["brightness"], 0)

    def test_sound_has_nothing_to_adjust(self) -> None:
        with TempMediaFolder() as root:
            response = self.suggest({"path": str(write_wav(root))})

            self.assertEqual(response.status_code, 400)

    @unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
    def test_a_video_take_is_read_within_its_crop(self) -> None:
        with TempMediaFolder() as root:
            media = write_video(root)
            crop = {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}

            response = self.suggest({"path": str(media), "start": 0.2, "end": 0.8, "crop": crop})

            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("saturation", response.json()["suggestion"])


class AllProjectsEndpointTests(unittest.TestCase):
    def all_paths(self, *roots: Path) -> list[str]:
        listing = client.get("/api/video-projects/all")
        self.assertEqual(listing.status_code, 200, listing.text)
        return [
            project["path"]
            for project in listing.json()["projects"]
            if Path(project["path"]).parent in roots
        ]

    def save_new(self, root: Path, name: str) -> str:
        document = client.get(f"/api/video-projects/new?folder={quote(str(root))}").json()
        project = {**document["project"], "name": name}
        saved = client.put(
            "/api/video-projects/project",
            json={"folder": str(root), "path": None, "base_revision": None, "project": project},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        return saved.json()["path"]

    def test_drafts_from_every_folder_the_app_has_seen_are_listed_newest_first(self) -> None:
        with TempMediaFolder() as first, TempMediaFolder() as second:
            # Written behind the app's back: it is found once its folder is listed.
            elsewhere, _ = save_project(second, None, None, new_empty_project())
            saved = self.save_new(first, "Trip")
            self.assertEqual(self.all_paths(first, second), [saved])

            client.get(f"/api/video-projects?folder={quote(str(second))}")
            self.assertEqual(self.all_paths(first, second), [saved, str(elsewhere)])

            client.delete(f"/api/video-projects/project?path={quote(saved)}")
            self.assertEqual(self.all_paths(first, second), [str(elsewhere)])

            elsewhere.unlink()
            self.assertEqual(self.all_paths(first, second), [])
            self.assertNotIn(str(elsewhere), map(str, known_draft_paths()))


class ExportEndpointTests(unittest.TestCase):
    def test_cancelling_an_unknown_export_is_not_found(self) -> None:
        self.assertEqual(client.post("/api/video-projects/exports/nope/cancel").status_code, 404)


if __name__ == "__main__":
    unittest.main()
