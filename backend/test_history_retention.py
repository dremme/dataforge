from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from testing_fixtures import forget_saved_settings, isolate_test_database

isolate_test_database()

from app_settings import update_app_settings
from automation.jobs import job_manager
from db import get_connection
from history_retention import prune_history
from notifications_store import clear_notifications_for_tests
from schemas import AppSettingsUpdate

FOLDER = r"C:\datasets\sample"


def iso_days_ago(days: float) -> str:
    return (datetime.now(tz=UTC) - timedelta(days=days)).isoformat()


def sqlite_days_ago(days: float) -> str:
    """The spelling sqlite's ``datetime('now')`` writes when it closes out an interrupted job."""
    return (datetime.now(tz=UTC) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def add_job(job_id: str, status: str, *, created_at: str, finished_at: str | None) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO jobs (id, folder, status, created_at, finished_at) VALUES (?, ?, ?, ?, ?)",
            (job_id, FOLDER, status, created_at, finished_at),
        )
        conn.commit()


def add_notification(row_id: str, created_at: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO notifications (id, message, variant, source, count, created_at)"
            " VALUES (?, 'Done.', 'success', 'job', 1, ?)",
            (row_id, created_at),
        )
        conn.commit()


def job_ids() -> set[str]:
    with get_connection() as conn:
        return {row[0] for row in conn.execute("SELECT id FROM jobs")}


def notification_ids() -> set[str]:
    with get_connection() as conn:
        return {row[0] for row in conn.execute("SELECT id FROM notifications")}


class HistoryRetentionTests(unittest.TestCase):
    def setUp(self) -> None:
        job_manager.delete_all_jobs()
        clear_notifications_for_tests()

    def tearDown(self) -> None:
        job_manager.delete_all_jobs()
        clear_notifications_for_tests()
        forget_saved_settings()

    def test_old_finished_jobs_go_and_everything_else_stays(self) -> None:
        add_job("old-iso", "completed", created_at=iso_days_ago(40), finished_at=iso_days_ago(40))
        add_job(
            "old-sqlite",
            "interrupted",
            created_at=iso_days_ago(40),
            finished_at=sqlite_days_ago(40),
        )
        add_job("old-unfinished", "failed", created_at=iso_days_ago(40), finished_at=None)
        add_job("recent", "completed", created_at=iso_days_ago(2), finished_at=iso_days_ago(2))
        add_job("old-running", "running", created_at=iso_days_ago(40), finished_at=None)
        add_job("old-queued", "queued", created_at=iso_days_ago(40), finished_at=None)

        prune_history()

        self.assertEqual(job_ids(), {"recent", "old-running", "old-queued"})

    def test_old_notifications_go(self) -> None:
        add_notification("old", iso_days_ago(40))
        add_notification("recent", iso_days_ago(1))

        prune_history()

        self.assertEqual(notification_ids(), {"recent"})

    def test_notifications_are_kept_for_three_days_by_default(self) -> None:
        add_notification("four-days", iso_days_ago(4))
        add_notification("two-days", iso_days_ago(2))

        prune_history()

        self.assertEqual(notification_ids(), {"two-days"})

    def test_the_window_follows_the_setting(self) -> None:
        add_job("week-old", "completed", created_at=iso_days_ago(8), finished_at=iso_days_ago(8))
        add_notification("two-days", iso_days_ago(2))

        prune_history()
        self.assertEqual(job_ids(), {"week-old"})
        self.assertEqual(notification_ids(), {"two-days"})

        update_app_settings(AppSettingsUpdate(job_history_days=7, notification_history_days=1))
        prune_history()

        self.assertEqual(job_ids(), set())
        self.assertEqual(notification_ids(), set())

    def test_zero_days_keeps_everything(self) -> None:
        add_job("ancient", "completed", created_at=iso_days_ago(900), finished_at=iso_days_ago(900))
        add_notification("ancient", iso_days_ago(900))
        update_app_settings(AppSettingsUpdate(job_history_days=0, notification_history_days=0))

        prune_history()

        self.assertEqual(job_ids(), {"ancient"})
        self.assertEqual(notification_ids(), {"ancient"})


if __name__ == "__main__":
    unittest.main()
