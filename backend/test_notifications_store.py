import unittest

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


if __name__ == "__main__":
    unittest.main()
