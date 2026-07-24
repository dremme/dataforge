"""Unit tests for automation.jobs_store persistence and migrations."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from automation.jobs_store import get_job as get_job_from_store
from automation.jobs_store import init_jobs_table
from db import close_all_connections, get_connection
from testing_fixtures import isolate_test_database

isolate_test_database()


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

            previous_db_path = os.environ.get("DATAFORGE_DB_PATH")
            os.environ["DATAFORGE_DB_PATH"] = str(db_path)
            close_all_connections()
            try:
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
            finally:
                close_all_connections()
                if previous_db_path is None:
                    os.environ.pop("DATAFORGE_DB_PATH", None)
                else:
                    os.environ["DATAFORGE_DB_PATH"] = previous_db_path


if __name__ == "__main__":
    unittest.main()
