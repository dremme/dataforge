from __future__ import annotations

import unittest
from unittest.mock import patch
from urllib.parse import quote

from automation.jobs_store import get_job as get_job_from_store
from automation.jobs_store import save_job
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    reset_job_manager,
    wait_for_job,
    write_media,
    write_sysprompt,
    write_txt_caption,
)

# Longer than ``DRAFT_CAPTION_THRESHOLD``, or the runner counts it as ``too_short``.
CAPTION = (
    "A red car is parked on a gravel driveway beside a low stone wall, with a row of "
    "birch trees behind it and a wooden gate standing open at the far end. Late "
    "afternoon light rakes across the gravel and throws long shadows toward the "
    "camera, and a bicycle leans against the wall on the left."
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

    def test_job_list_omits_per_file_results(self) -> None:
        """Results ride ``/jobs/{id}/results``, never the polled list."""
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            with patch("automation.auto_caption.complete_caption", return_value=CAPTION):
                started = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")
                job_id = started.json()["id"]
                wait_for_job(job_id)

            for payload in (
                next(job for job in client.get("/api/jobs").json()["jobs"] if job["id"] == job_id),
                client.get(f"/api/jobs/{job_id}").json(),
                client.get(f"/api/jobs/folder-latest?path={quote(str(root))}").json(),
            ):
                self.assertNotIn("results", payload)

    def test_job_results_endpoint_serves_the_per_file_detail(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            with patch("automation.auto_caption.complete_caption", return_value=CAPTION):
                started = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")
                job_id = started.json()["id"]
                wait_for_job(job_id)

            response = client.get(f"/api/jobs/{job_id}/results")
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["job_id"], job_id)
            self.assertEqual(
                [(result["name"], result["description"]) for result in payload["results"]],
                [("photo.png", CAPTION)],
            )

    def test_job_results_come_from_the_store_when_memory_has_no_such_job(self) -> None:
        """History outlives the process that wrote it, so a stored-only job still answers."""
        save_job(
            {
                "id": "stored-only",
                "folder": r"C:\datasets\sample",
                "job_type": "auto_caption",
                "status": "completed",
                "total": 1,
                "processed": 1,
                "stats": {"success": 1},
                "results": [{"path": "a.png", "name": "a.png", "status": "success"}],
                "created_at": "2026-01-01T00:00:00+00:00",
            }
        )

        payload = client.get("/api/jobs/stored-only/results").json()
        self.assertEqual([result["name"] for result in payload["results"]], ["a.png"])

    def test_job_results_are_404_for_an_unknown_job(self) -> None:
        self.assertEqual(client.get("/api/jobs/does-not-exist/results").status_code, 404)

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

    def test_delete_all_jobs_removes_more_than_one_page(self) -> None:
        for index in range(120):
            _stored(
                f"bulk-{index:03}", created_at=f"2026-01-01T00:{index // 60:02}:{index % 60:02}"
            )

        self.assertEqual(client.delete("/api/jobs").json()["deleted_count"], 120)
        self.assertEqual(client.get("/api/jobs").json()["total"], 0)


def _stored(
    job_id: str,
    *,
    folder: str = r"C:\datasets\sample",
    job_type: str = "auto_caption",
    status: str = "completed",
    created_at: str = "2026-01-01T00:00:00+00:00",
) -> None:
    save_job(
        {
            "id": job_id,
            "folder": folder,
            "job_type": job_type,
            "status": status,
            "created_at": created_at,
        }
    )


def _ids(query: str = "") -> list[str]:
    return [job["id"] for job in client.get(f"/api/jobs{query}").json()["jobs"]]


class JobHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def tearDown(self) -> None:
        reset_job_manager()

    def test_a_second_run_for_the_same_folder_and_type_keeps_the_first(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            job_ids = []
            with patch("automation.auto_caption.complete_caption", return_value=None):
                for _ in range(2):
                    started = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")
                    job_ids.append(started.json()["id"])
                    wait_for_job(job_ids[-1])

            self.assertEqual(set(_ids()), set(job_ids))
            self.assertIsNotNone(get_job_from_store(job_ids[0]))

    def test_restarting_the_manager_keeps_earlier_runs(self) -> None:
        from automation.jobs import job_manager

        _stored("older", created_at="2026-01-01T00:00:00+00:00")
        _stored("newer", created_at="2026-01-02T00:00:00+00:00")

        job_manager.initialize()

        self.assertEqual(_ids(), ["newer", "older"])

    def test_filters_by_type_status_and_folder(self) -> None:
        _stored("caption", job_type="auto_caption", status="completed")
        _stored("mark", job_type="watermark", status="failed", folder=r"C:\datasets\other")
        _stored("halted", job_type="watermark", status="interrupted")
        _stored("cancelled", job_type="auto_caption", status="cancelled")

        self.assertEqual(set(_ids("?job_type=watermark")), {"mark", "halted"})
        self.assertEqual(set(_ids("?status=stopped")), {"halted", "cancelled"})
        self.assertEqual(_ids("?status=failed"), ["mark"])
        self.assertEqual(
            set(_ids(f"?folder={quote(r'C:\datasets\sample')}")), {"caption", "halted", "cancelled"}
        )
        self.assertEqual(_ids("?job_type=watermark&status=stopped"), ["halted"])

    def test_pages_through_matching_jobs_with_a_total(self) -> None:
        for index in range(5):
            _stored(f"job-{index}", created_at=f"2026-01-0{index + 1}T00:00:00+00:00")

        first = client.get("/api/jobs?limit=2").json()
        second = client.get("/api/jobs?limit=2&offset=2").json()

        self.assertEqual([job["id"] for job in first["jobs"]], ["job-4", "job-3"])
        self.assertEqual([job["id"] for job in second["jobs"]], ["job-2", "job-1"])
        self.assertEqual(first["total"], 5)

    def test_the_active_count_ignores_the_filter(self) -> None:
        _stored("running", job_type="watermark", status="running")
        _stored("done", job_type="auto_caption", status="completed")

        payload = client.get("/api/jobs?job_type=auto_caption").json()

        self.assertEqual(payload["active_count"], 1)
        self.assertEqual(payload["total"], 1)

    def test_an_unknown_status_filter_is_rejected(self) -> None:
        self.assertEqual(client.get("/api/jobs?status=cancelled").status_code, 422)


if __name__ == "__main__":
    unittest.main()
