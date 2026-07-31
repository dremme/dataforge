"""Unit tests for automation.jobs_store persistence and migrations."""

from __future__ import annotations

import contextlib
import os
import sqlite3
import tempfile
import unittest
from collections.abc import Iterator
from pathlib import Path

from automation.jobs_store import get_job as get_job_from_store
from automation.jobs_store import init_jobs_table, list_active_jobs, save_job
from db import close_all_connections, get_connection
from testing_fixtures import isolate_test_database

isolate_test_database()

_JOBS_TABLE_WITHOUT_EXTERNAL_REF = """
    CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        folder TEXT NOT NULL,
        job_type TEXT NOT NULL DEFAULT 'auto_caption',
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        current_file TEXT,
        current_name TEXT,
        stats_json TEXT NOT NULL DEFAULT '{}',
        results_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        auto_caption_mode TEXT
    )
"""


@contextlib.contextmanager
def _database_at(db_path: Path) -> Iterator[None]:
    previous = os.environ.get("DATAFORGE_DB_PATH")
    os.environ["DATAFORGE_DB_PATH"] = str(db_path)
    close_all_connections()
    try:
        yield
    finally:
        close_all_connections()
        if previous is None:
            os.environ.pop("DATAFORGE_DB_PATH", None)
        else:
            os.environ["DATAFORGE_DB_PATH"] = previous


class JobsTableMigrationTests(unittest.TestCase):
    def test_migrates_legacy_auto_caption_jobs_table(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "migrate.db"
            conn = sqlite3.connect(db_path)
            conn.execute(
                """
                CREATE TABLE auto_caption_jobs (
                    id TEXT PRIMARY KEY,
                    folder TEXT NOT NULL,
                    status TEXT NOT NULL,
                    total INTEGER NOT NULL DEFAULT 0,
                    processed INTEGER NOT NULL DEFAULT 0,
                    current_file TEXT,
                    current_name TEXT,
                    stats_json TEXT NOT NULL DEFAULT '{}',
                    results_json TEXT NOT NULL DEFAULT '[]',
                    error TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT
                )
                """
            )
            conn.execute(
                """
                INSERT INTO auto_caption_jobs (
                    id, folder, status, total, processed, stats_json, results_json,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "legacy-job-1",
                    "C:\\Photos\\legacy",
                    "completed",
                    2,
                    2,
                    '{"success": 2}',
                    "[]",
                    "2026-01-01T00:00:00+00:00",
                ),
            )
            conn.commit()
            conn.close()

            with _database_at(db_path):
                init_jobs_table()

                migrated = get_job_from_store("legacy-job-1")
                self.assertIsNotNone(migrated)
                assert migrated is not None
                self.assertEqual(migrated["job_type"], "auto_caption")
                self.assertEqual(migrated["stats"]["success"], 2)

                with get_connection() as verify_conn:
                    legacy = verify_conn.execute(
                        """
                        SELECT 1 FROM sqlite_master
                        WHERE type = 'table' AND name = 'auto_caption_jobs'
                        """
                    ).fetchone()
                    jobs = verify_conn.execute(
                        """
                        SELECT 1 FROM sqlite_master
                        WHERE type = 'table' AND name = 'jobs'
                        """
                    ).fetchone()

                self.assertIsNone(legacy)
                self.assertIsNotNone(jobs)


class ExternalRefColumnTests(unittest.TestCase):
    def test_adds_the_column_without_losing_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "external-ref.db"
            conn = sqlite3.connect(db_path)
            conn.execute(_JOBS_TABLE_WITHOUT_EXTERNAL_REF)
            conn.execute(
                """
                INSERT INTO jobs (id, folder, job_type, status, created_at)
                VALUES ('old-job-1', 'C:\\Photos\\sample', 'auto_caption', 'completed', ?)
                """,
                ("2026-01-01T00:00:00+00:00",),
            )
            conn.commit()
            conn.close()

            with _database_at(db_path):
                init_jobs_table()

                migrated = get_job_from_store("old-job-1")
                self.assertIsNotNone(migrated)
                assert migrated is not None
                self.assertIsNone(migrated["external_ref"])

    def test_a_second_startup_does_not_rebuild_the_table(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "stable.db"

            with _database_at(db_path):
                init_jobs_table()
                with get_connection() as conn:
                    first = conn.execute(
                        "SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'jobs'"
                    ).fetchone()

                init_jobs_table()
                with get_connection() as conn:
                    second = conn.execute(
                        "SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'jobs'"
                    ).fetchone()

            self.assertEqual(first, second)

    def test_round_trips_the_external_reference(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "round-trip.db"

            with _database_at(db_path):
                init_jobs_table()
                save_job(
                    {
                        "id": "train-1",
                        "folder": "C:\\datasets\\sample",
                        "job_type": "train_lora",
                        "status": "running",
                        "created_at": "2026-01-01T00:00:00+00:00",
                        "external_ref": "sample_train_v1",
                    }
                )

                stored = get_job_from_store("train-1")
                active = list_active_jobs()

            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored["external_ref"], "sample_train_v1")
            self.assertEqual([job["id"] for job in active], ["train-1"])


if __name__ == "__main__":
    unittest.main()
