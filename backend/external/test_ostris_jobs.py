from __future__ import annotations

import contextlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

from external.ostris_jobs import (
    OstrisJobStopError,
    fetch_active_ostris_jobs,
    normalize_ostris_job,
    request_graceful_stop,
    resolve_sqlite_db_path,
    stop_ostris_job_with_checkpoint,
    wait_for_save_next_step,
)


def _sample_job_config(*, steps: int = 100, dataset_folder: str = "C:\\datasets\\photos") -> str:
    return json.dumps(
        {
            "job": "extension",
            "config": {
                "name": "sample_train",
                "process": [
                    {
                        "type": "diffusion_trainer",
                        "training_folder": "C:\\AI-Toolkit\\output",
                        "sqlite_db_path": "./aitk_db.db",
                        "datasets": [{"folder_path": dataset_folder}],
                        "train": {"steps": steps},
                        "model": {"name_or_path": "krea/Krea-2-Turbo"},
                    }
                ],
            },
        }
    )


class NormalizeOstrisJobTests(unittest.TestCase):
    def test_returns_none_for_completed_jobs(self) -> None:
        raw_job = {
            "id": "job-1",
            "name": "done_train",
            "status": "completed",
            "step": 100,
            "job_config": _sample_job_config(),
        }

        self.assertIsNone(normalize_ostris_job(raw_job))

    def test_normalizes_running_training_job(self) -> None:
        raw_job = {
            "id": "job-2",
            "name": "active_train",
            "status": "running",
            "step": 42,
            "total_steps": None,
            "info": "Training",
            "speed_string": "2.15 sec/iter",
            "job_type": "train",
            "created_at": "2026-01-01T00:00:00.000Z",
            "save_now": True,
            "stop": False,
            "job_config": _sample_job_config(steps=500, dataset_folder="C:\\datasets\\landscapes"),
        }

        normalized = normalize_ostris_job(raw_job)

        self.assertIsNotNone(normalized)
        assert normalized is not None
        self.assertEqual(normalized["id"], "job-2")
        self.assertEqual(normalized["name"], "active_train")
        self.assertEqual(normalized["step"], 42)
        self.assertEqual(normalized["total_steps"], 500)
        self.assertEqual(normalized["dataset_folder"], "C:\\datasets\\landscapes")
        self.assertEqual(normalized["dataset_folder_name"], "landscapes")
        self.assertEqual(normalized["model"], "krea/Krea-2-Turbo")
        self.assertEqual(normalized["speed_string"], "2.15 sec/iter")
        self.assertTrue(normalized["save_now"])
        self.assertFalse(normalized["stop_requested"])


class ResolveSqliteDbPathTests(unittest.TestCase):
    def test_resolves_relative_db_path_from_training_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            toolkit_root = Path(temp_dir)
            output_dir = toolkit_root / "output"
            output_dir.mkdir()
            db_path = toolkit_root / "aitk_db.db"
            db_path.write_text("", encoding="utf-8")

            raw_job = {
                "job_config": json.dumps(
                    {
                        "config": {
                            "process": [
                                {
                                    "training_folder": str(output_dir),
                                    "sqlite_db_path": "./aitk_db.db",
                                }
                            ]
                        }
                    }
                )
            }

            resolved = resolve_sqlite_db_path(raw_job)

            self.assertEqual(resolved, db_path.resolve())


class FetchActiveOstrisJobsTests(unittest.TestCase):
    def test_returns_empty_list_when_ostris_is_unreachable(self) -> None:
        with patch("external.ostris_jobs.httpx.Client") as client_cls:
            client_cls.return_value.__enter__.return_value.get.side_effect = httpx.TimeoutException(
                "timed out"
            )

            jobs, available = fetch_active_ostris_jobs()

        self.assertEqual(jobs, [])
        self.assertFalse(available)

    def test_returns_only_running_jobs(self) -> None:
        payload = {
            "jobs": [
                {
                    "id": "done",
                    "name": "done_train",
                    "status": "completed",
                    "step": 100,
                    "job_config": _sample_job_config(),
                },
                {
                    "id": "active",
                    "name": "active_train",
                    "status": "running",
                    "step": 10,
                    "job_config": _sample_job_config(steps=100),
                },
            ]
        }

        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = payload

        with patch("external.ostris_jobs.httpx.Client") as client_cls:
            client_cls.return_value.__enter__.return_value.get.return_value = response

            jobs, available = fetch_active_ostris_jobs()

        self.assertTrue(available)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["id"], "active")


class StopOstrisJobTests(unittest.TestCase):
    def test_wait_for_save_next_step_waits_until_checkpoint_save_finishes(self) -> None:
        client = Mock()
        client.get.side_effect = [
            Mock(
                raise_for_status=Mock(),
                json=Mock(return_value={"id": "job-1", "save_now": True, "info": "Training"}),
            ),
            Mock(
                raise_for_status=Mock(),
                json=Mock(
                    return_value={
                        "id": "job-1",
                        "save_now": False,
                        "status": "running",
                        "info": "Saving model",
                    }
                ),
            ),
            Mock(
                raise_for_status=Mock(),
                json=Mock(
                    return_value={
                        "id": "job-1",
                        "save_now": False,
                        "status": "running",
                        "info": "Training",
                    }
                ),
            ),
        ]

        job = wait_for_save_next_step(
            client,
            "job-1",
            poll_interval_seconds=0,
            max_wait_seconds=1,
        )

        self.assertFalse(job["save_now"])
        self.assertEqual(job["info"], "Training")

    def test_request_graceful_stop_sets_stop_flag(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            db_path = Path(temp_db.name)

        try:
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    "CREATE TABLE Job (id TEXT PRIMARY KEY, stop BOOLEAN NOT NULL, info TEXT NOT NULL)"
                )
                conn.execute("INSERT INTO Job (id, stop, info) VALUES ('job-1', 0, 'Training')")
                conn.commit()
            finally:
                conn.close()

            request_graceful_stop(db_path, "job-1")

            conn = sqlite3.connect(db_path)
            try:
                row = conn.execute("SELECT stop, info FROM Job WHERE id = 'job-1'").fetchone()
            finally:
                conn.close()

            self.assertEqual(row, (1, "Stopping job..."))
        finally:
            with contextlib.suppress(PermissionError):
                db_path.unlink(missing_ok=True)

    def test_stop_ostris_job_with_checkpoint_waits_for_save_before_stop(self) -> None:
        running_job = {
            "id": "job-1",
            "name": "active_train",
            "status": "running",
            "save_now": False,
            "job_config": _sample_job_config(),
        }
        saved_job = {**running_job, "save_now": False}
        stopped_job = {**running_job, "status": "stopped", "save_now": False}
        db_path = Path("C:/AI-Toolkit/aitk_db.db")

        running_job["job_config"] = json.dumps(
            {
                "config": {
                    "process": [
                        {
                            "training_folder": "C:/AI-Toolkit/output",
                            "sqlite_db_path": "./aitk_db.db",
                        }
                    ]
                }
            }
        )
        saved_job["job_config"] = running_job["job_config"]
        stopped_job["job_config"] = running_job["job_config"]

        client = Mock()
        saved_job["info"] = "Training"
        running_job["info"] = "Training"

        client.get.side_effect = [
            Mock(raise_for_status=Mock(), json=Mock(return_value=running_job)),
            Mock(raise_for_status=Mock(), json=Mock(return_value=running_job)),
            Mock(
                raise_for_status=Mock(),
                json=Mock(
                    return_value={
                        "id": "job-1",
                        "save_now": False,
                        "status": "running",
                        "info": "Training",
                    }
                ),
            ),
            Mock(raise_for_status=Mock(), json=Mock(return_value=stopped_job)),
        ]

        with (
            patch("external.ostris_jobs.httpx.Client") as client_cls,
            patch("external.ostris_jobs.resolve_sqlite_db_path", return_value=db_path),
            patch("external.ostris_jobs.request_graceful_stop") as stop_mock,
        ):
            client_cls.return_value.__enter__.return_value = client
            result = stop_ostris_job_with_checkpoint("job-1")

        self.assertEqual(result["status"], "stopped")
        save_now_calls = [
            call
            for call in client.get.call_args_list
            if call.args and str(call.args[0]).endswith("/save_now")
        ]
        self.assertEqual(len(save_now_calls), 1)
        stop_mock.assert_called_once_with(db_path, "job-1")

    def test_stop_ostris_job_with_checkpoint_rejects_non_running_jobs(self) -> None:
        client = Mock()
        client.get.return_value = Mock(
            raise_for_status=Mock(),
            json=Mock(return_value={"id": "job-1", "status": "stopped"}),
        )

        with patch("external.ostris_jobs.httpx.Client") as client_cls:
            client_cls.return_value.__enter__.return_value = client
            with self.assertRaises(OstrisJobStopError):
                stop_ostris_job_with_checkpoint("job-1")
