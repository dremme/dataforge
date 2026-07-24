"""Tests for /api/external/ostris/jobs."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from routes._test_client import client


class ExternalOstrisJobsEndpointTests(unittest.TestCase):
    def test_returns_active_jobs_when_ostris_is_available(self) -> None:
        jobs = [
            {
                "id": "active",
                "name": "active_train",
                "status": "running",
                "step": 10,
                "total_steps": 100,
                "info": "Training",
                "speed_string": "2.15 sec/iter",
                "job_type": "train",
                "dataset_folder": "C:\\datasets\\photos",
                "dataset_folder_name": "photos",
                "model": "krea/Krea-2-Turbo",
                "created_at": "2026-01-01T00:00:00.000Z",
                "save_now": False,
                "stop_requested": False,
            }
        ]

        with patch("routes.external_jobs.fetch_active_ostris_jobs", return_value=(jobs, True)):
            response = client.get("/api/external/ostris/jobs")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["available"])
        self.assertEqual(payload["active_count"], 1)
        self.assertEqual(payload["jobs"][0]["name"], "active_train")

    def test_returns_empty_payload_when_ostris_is_unreachable(self) -> None:
        with patch("routes.external_jobs.fetch_active_ostris_jobs", return_value=([], False)):
            response = client.get("/api/external/ostris/jobs")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertEqual(payload["active_count"], 0)
        self.assertEqual(payload["jobs"], [])

    def test_stops_running_ostris_job(self) -> None:
        with patch(
            "routes.external_jobs.stop_ostris_job_with_checkpoint",
            return_value={"status": "stopped"},
        ):
            response = client.post("/api/external/ostris/jobs/job-1/stop")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["message"], "Checkpoint saved and job stopped.")

    def test_returns_error_when_stop_fails(self) -> None:
        from external.ostris_jobs import OstrisJobStopError

        with patch(
            "routes.external_jobs.stop_ostris_job_with_checkpoint",
            side_effect=OstrisJobStopError("Only running Ostris jobs can be stopped."),
        ):
            response = client.post("/api/external/ostris/jobs/job-1/stop")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Only running Ostris jobs can be stopped.")
