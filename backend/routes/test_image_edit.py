"""Tests for /api/media/image-edit."""

from __future__ import annotations

import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from PIL import Image

import edit_sidecars
from routes._test_client import client
from schemas import ImageEditSpec
from testing_fixtures import TempMediaFolder, write_gif, write_image, write_mp4_video

EDIT_URL = "/api/media/image-edit"


def edit_url(media: Path, suffix: str = "") -> str:
    return f"{EDIT_URL}{suffix}?path={quote(str(media))}"


class ImageEditStateTests(unittest.TestCase):
    def test_an_unedited_image_reports_no_backup_and_no_spec(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            response = client.get(edit_url(media))

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(media))
            self.assertFalse(payload["has_backup"])
            self.assertIsNone(payload["spec"])

    def test_an_edited_image_reports_the_spec_it_was_rendered_with(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            edit_sidecars.backup_path_for(media).write_bytes(b"original")
            edit_sidecars.write_spec(media, ImageEditSpec(rotate=90, mirror_h=True, scale=0.5))

            payload = client.get(edit_url(media)).json()

            self.assertTrue(payload["has_backup"])
            self.assertEqual(payload["spec"]["rotate"], 90)
            self.assertTrue(payload["spec"]["mirror_h"])
            self.assertEqual(payload["spec"]["scale"], 0.5)

    def test_a_missing_file_is_a_404(self) -> None:
        with TempMediaFolder() as root:
            self.assertEqual(client.get(edit_url(root / "gone.png")).status_code, 404)

    def test_a_video_is_a_400(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            self.assertEqual(client.get(edit_url(media)).status_code, 400)

    def test_a_gif_is_a_400(self) -> None:
        """A Pillow round-trip would flatten the animation; GIF keeps frame capture."""
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            self.assertEqual(client.get(edit_url(media)).status_code, 400)


class ApplyImageEditTests(unittest.TestCase):
    def test_a_valid_spec_renders_and_reports_the_new_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=40, height=20)

            response = client.post(edit_url(media), json={"rotate": 90})

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(media))
            self.assertTrue(payload["has_backup"])
            self.assertEqual(payload["width"], 20)
            self.assertEqual(payload["height"], 40)
            self.assertEqual(payload["size"], media.stat().st_size)

    def test_the_spec_survives_for_the_next_time_the_editor_opens(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            client.post(edit_url(media), json={"rotate": 180, "mirror_v": True})

            payload = client.get(edit_url(media)).json()
            self.assertEqual(payload["spec"]["rotate"], 180)
            self.assertTrue(payload["spec"]["mirror_v"])

    def test_an_edit_that_changes_nothing_is_refused(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            response = client.post(edit_url(media), json={})

            self.assertEqual(response.status_code, 400)
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())

    def test_a_full_frame_crop_counts_as_no_crop_at_all(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            response = client.post(
                edit_url(media),
                json={"crop": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}},
            )

            self.assertEqual(response.status_code, 400)

    def test_an_out_of_range_scale_is_rejected_by_the_schema(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            self.assertEqual(client.post(edit_url(media), json={"scale": 2.0}).status_code, 422)
            self.assertEqual(client.post(edit_url(media), json={"scale": 0.0}).status_code, 422)

    def test_an_angle_that_is_not_a_quarter_turn_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            self.assertEqual(client.post(edit_url(media), json={"rotate": 45}).status_code, 422)

    def test_a_crop_reaching_past_the_frame_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            response = client.post(
                edit_url(media),
                json={"crop": {"x": 0.8, "y": 0.0, "width": 0.5, "height": 0.5}},
            )

            self.assertEqual(response.status_code, 422)

    def test_an_unreadable_source_surfaces_as_a_500_rather_than_a_crash(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            with patch("image_edit.load_image_for_edit", side_effect=OSError("truncated")):
                response = client.post(edit_url(media), json={"rotate": 90})

            self.assertEqual(response.status_code, 500)
            self.assertIn("truncated", response.json()["detail"])

    def test_a_second_render_of_the_same_file_answers_409(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            holding = threading.Event()
            release = threading.Event()

            def hold(*_args, **_kwargs):
                holding.set()
                release.wait(timeout=5)
                raise OSError("released")

            def first() -> None:
                with patch("image_edit.load_image_for_edit", side_effect=hold):
                    client.post(edit_url(media), json={"rotate": 90})

            worker = threading.Thread(target=first)
            worker.start()
            try:
                holding.wait(timeout=5)
                second = client.post(edit_url(media), json={"rotate": 180})
            finally:
                release.set()
                worker.join(timeout=5)

            self.assertEqual(second.status_code, 409)

    def test_a_video_cannot_be_posted_to_the_image_editor(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            self.assertEqual(client.post(edit_url(media), json={"rotate": 90}).status_code, 400)


class RevertImageEditTests(unittest.TestCase):
    def test_reverting_restores_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=40, height=20)
            original = media.read_bytes()
            client.post(edit_url(media), json={"rotate": 90})

            response = client.post(edit_url(media, "/revert"))

            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["has_backup"])
            self.assertEqual(media.read_bytes(), original)
            self.assertFalse(edit_sidecars.edit_spec_path(media).exists())

    def test_reverting_without_a_backup_is_a_400(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            self.assertEqual(client.post(edit_url(media, "/revert")).status_code, 400)


class ServeOriginalTests(unittest.TestCase):
    def test_the_original_flag_serves_the_image_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=40, height=20)
            original = media.read_bytes()
            client.post(edit_url(media), json={"rotate": 90})

            response = client.get(f"/api/media?path={quote(str(media))}&original=1")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, original)
            self.assertEqual(response.headers["content-type"], "image/png")

    def test_without_the_flag_the_edited_image_is_served(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=40, height=20)
            client.post(edit_url(media), json={"rotate": 90})

            response = client.get(f"/api/media?path={quote(str(media))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, media.read_bytes())

    def test_the_original_flag_falls_back_to_the_file_itself(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            response = client.get(f"/api/media?path={quote(str(media))}&original=1")

            self.assertEqual(response.content, media.read_bytes())


class EditedImageListingTests(unittest.TestCase):
    def test_the_folder_listing_reports_the_backup_an_image_edit_left(self) -> None:
        """`has_backup` is what puts Revert on the panel, and it is computed by suffix."""
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=40, height=20)
            client.post(edit_url(media), json={"rotate": 90})

            payload = client.get(f"/api/folders/contents?path={quote(str(root))}").json()

            entry = next(item for item in payload["items"] if item["name"] == media.name)
            self.assertTrue(entry["has_backup"])

    def test_the_sidecars_do_not_surface_as_gallery_items_of_their_own(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=40, height=20)
            client.post(edit_url(media), json={"rotate": 90})

            payload = client.get(f"/api/folders/contents?path={quote(str(root))}").json()

            self.assertEqual([item["name"] for item in payload["items"]], [media.name])

    def test_the_edited_file_is_readable_afterwards(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=40, height=20)
            client.post(edit_url(media), json={"rotate": 90})

            with Image.open(media) as written:
                self.assertEqual(written.size, (20, 40))


if __name__ == "__main__":
    unittest.main()
