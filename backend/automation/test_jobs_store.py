from __future__ import annotations

import contextlib
import os
import tempfile
import unittest
from collections.abc import Generator
from pathlib import Path

from automation.jobs_store import get_job as get_job_from_store
from automation.jobs_store import init_jobs_table, list_active_jobs, save_job
from db import close_all_connections
from testing_fixtures import isolate_test_database

isolate_test_database()


@contextlib.contextmanager
def _database_at(db_path: Path) -> Generator[None]:
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


class JobsStoreTests(unittest.TestCase):
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
