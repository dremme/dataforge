import os
import sqlite3
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from db import close_all_connections, get_connection
from notifications_store import (
    MAX_NOTIFICATIONS,
    clear_notifications_for_tests,
    delete_all_notifications,
    init_notifications_table,
    insert_notification,
    list_notifications,
    mark_all_read,
)
from testing_fixtures import isolate_test_database

isolate_test_database()

_NOTIFICATIONS_TABLE_WITHOUT_COUNT = """
    CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT 'success',
        source TEXT NOT NULL DEFAULT 'client',
        job_id TEXT,
        created_at TEXT NOT NULL,
        read_at TEXT
    )
"""


@contextmanager
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


def _record(message: str, *, variant: str = "success", source: str = "client") -> dict[str, object]:
    return insert_notification(message=message, variant=variant, source=source)


class NotificationsStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        init_notifications_table()
        clear_notifications_for_tests()

    def test_a_new_notification_starts_unread_and_uncollapsed(self) -> None:
        stored = _record("Auto-caption completed.")

        self.assertEqual(stored["count"], 1)
        self.assertIsNone(stored["read_at"])
        self.assertEqual(stored["message"], "Auto-caption completed.")

    def test_an_immediate_repeat_collapses_into_the_newest_row(self) -> None:
        _record("Could not read the folder.", variant="danger")
        second = _record("Could not read the folder.", variant="danger")

        self.assertEqual(second["count"], 2)
        self.assertEqual(len(list_notifications()), 1)

    def test_an_interleaved_message_ends_the_run(self) -> None:
        _record("Could not read the folder.", variant="danger")
        _record("Folder path copied.")
        _record("Could not read the folder.", variant="danger")

        counts = [row["count"] for row in list_notifications()]
        self.assertEqual(counts, [1, 1, 1])

    def test_a_repeat_does_not_collapse_across_sources(self) -> None:
        _record("Auto-caption completed.", source="job")
        _record("Auto-caption completed.", source="client")

        self.assertEqual(len(list_notifications()), 2)

    def test_a_repeat_into_a_read_row_makes_it_unread_again(self) -> None:
        _record("Could not read the folder.", variant="danger")
        mark_all_read()

        repeated = _record("Could not read the folder.", variant="danger")

        self.assertIsNone(repeated["read_at"])

    def test_only_the_newest_rows_are_kept(self) -> None:
        for index in range(MAX_NOTIFICATIONS + 10):
            _record(f"Message {index}")

        stored = list_notifications()

        self.assertEqual(len(stored), MAX_NOTIFICATIONS)
        self.assertEqual(stored[0]["message"], f"Message {MAX_NOTIFICATIONS + 9}")
        self.assertEqual(stored[-1]["message"], "Message 10")

    def test_marking_read_leaves_existing_timestamps_alone(self) -> None:
        _record("First.")
        mark_all_read()
        first_read_at = list_notifications()[0]["read_at"]

        _record("Second.")
        mark_all_read()

        by_message = {row["message"]: row for row in list_notifications()}
        self.assertEqual(by_message["First."]["read_at"], first_read_at)
        self.assertIsNotNone(by_message["Second."]["read_at"])

    def test_clearing_reports_how_many_rows_went(self) -> None:
        _record("First.")
        _record("Second.")

        self.assertEqual(delete_all_notifications(), 2)
        self.assertEqual(list_notifications(), [])


class NotificationsSchemaMigrationTests(unittest.TestCase):
    def test_a_table_predating_the_count_column_gains_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "old.db"
            conn = sqlite3.connect(db_path)
            conn.execute(_NOTIFICATIONS_TABLE_WITHOUT_COUNT)
            conn.execute(
                "INSERT INTO notifications (id, message, variant, source, created_at)"
                " VALUES ('old-1', 'Older message.', 'success', 'client', '2026-01-01T00:00:00Z')"
            )
            conn.commit()
            conn.close()

            with _database_at(db_path):
                init_notifications_table()

                stored = list_notifications()
                self.assertEqual(len(stored), 1)
                self.assertEqual(stored[0]["count"], 1)

    def test_a_retired_column_is_rebuilt_away(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "extra.db"

            with _database_at(db_path):
                init_notifications_table()
                with get_connection() as conn:
                    conn.execute("ALTER TABLE notifications ADD COLUMN retired TEXT")
                    conn.commit()

                init_notifications_table()

                with get_connection() as conn:
                    columns = {row[1] for row in conn.execute("PRAGMA table_info(notifications)")}
                self.assertNotIn("retired", columns)


if __name__ == "__main__":
    unittest.main()
