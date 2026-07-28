"""Tests for /api/jobs/*."""

from __future__ import annotations

import unittest
from unittest.mock import patch
from urllib.parse import quote

from automation.jobs_store import get_job as get_job_from_store
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    reset_job_manager,
    wait_for_job,
    write_media,
    write_sysprompt,
    write_txt_caption,
)


class JobsEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_lists_jobs_globally(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch("automation.auto_caption.complete_caption", return_value=None):
                started = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")
                job_id = started.json()["id"]
                finished = wait_for_job(job_id)

            self.assertEqual(finished.status, "failed")

            listed = client.get("/api/jobs")
            self.assertEqual(listed.status_code, 200)
            payload = listed.json()
            matching = next(job for job in payload["jobs"] if job["id"] == job_id)
            self.assertEqual(matching["status"], "failed")
            # Global active count must ignore this finished job and any stale rows.
            self.assertEqual(payload["active_count"], 0)

    def test_delete_single_job(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            started = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")
            job_id = started.json()["id"]

            deleted = client.delete(f"/api/jobs/{job_id}")
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(deleted.json()["deleted_count"], 1)
            self.assertIsNone(get_job_from_store(job_id))

            missing = client.get(f"/api/jobs/{job_id}")
            self.assertEqual(missing.status_code, 404)

    def test_delete_all_jobs(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            client.post(f"/api/automation/auto-caption?path={quote(str(root))}")

            deleted = client.delete("/api/jobs")
            self.assertEqual(deleted.status_code, 200)
            self.assertGreaterEqual(deleted.json()["deleted_count"], 1)

            listed = client.get("/api/jobs")
            self.assertEqual(listed.json()["jobs"], [])


if __name__ == "__main__":
    unittest.main()
