"""HTTP contract tests for /api/automation/*."""

from __future__ import annotations

import unittest
from urllib.parse import quote

from automation.jobs import Job, job_manager
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    reset_job_manager,
    write_media,
    write_sysprompt,
    write_txt_caption,
)


class AutoCaptionAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_requires_sysprompt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Short draft.")

            response = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn(".sysprompt", response.json()["detail"])

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")

            response = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images or videos", response.json()["detail"])

    def test_rejects_duplicate_active_job(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            folder = str(root.resolve())
            with job_manager._lock:
                job_manager._jobs["running-test"] = Job(
                    id="running-test",
                    folder=folder,
                    status="running",
                )

            response = client.post(f"/api/automation/auto-caption?path={quote(folder)}")
            self.assertEqual(response.status_code, 400)
            self.assertIn("already running", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            response = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["job_type"], "auto_caption")
            self.assertEqual(payload.get("auto_caption_mode"), "thinking")
            self.assertIn("id", payload)


class BodyPartsAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_requires_supported_images(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(f"/api/automation/body-parts?path={quote(str(root))}")
            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images", response.json()["detail"])

    def test_rejects_when_any_job_is_active_for_folder(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            folder = str(root.resolve())

            with job_manager._lock:
                job_manager._jobs["running-auto"] = Job(
                    id="running-auto",
                    folder=folder,
                    status="running",
                )

            response = client.post(f"/api/automation/body-parts?path={quote(folder)}")
            self.assertEqual(response.status_code, 400)
            self.assertIn("already running", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = client.post(f"/api/automation/body-parts?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "body_parts")


class StripMetadataAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_rejects_folder_without_supported_files(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(f"/api/automation/strip-metadata?path={quote(str(root))}")
            self.assertEqual(response.status_code, 400)
            self.assertIn("No PNG or MP4", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", text_chunks={"workflow": '{"nodes":{}}'})

            response = client.post(f"/api/automation/strip-metadata?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "strip_metadata")


class SetCaptionsAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                f"/api/automation/set-captions?path={quote(str(root))}",
                json={"caption": "Shared caption."},
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images or videos", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = client.post(
                f"/api/automation/set-captions?path={quote(str(root))}",
                json={"caption": "Shared caption."},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "set_captions")


class VerifyCaptionsAutomationEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def tearDown(self) -> None:
        from db import get_connection
        from verify_captions_settings import VERIFY_CAPTIONS_SETTINGS_KEY

        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key = ?",
                (VERIFY_CAPTIONS_SETTINGS_KEY,),
            )
            conn.commit()

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(f"/api/automation/verify-captions?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            response = client.post(
                f"/api/automation/verify-captions?path={quote(str(root))}",
                json={"mode": "thinking", "context": "Outdoor portraits."},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "verify_captions")


if __name__ == "__main__":
    unittest.main()
