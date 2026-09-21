import unittest

import events
from notifications_store import clear_notifications_for_tests, init_notifications_table
from routes._test_client import client


class NotificationRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        init_notifications_table()
        clear_notifications_for_tests()
        events.clear_subscribers_for_tests()

    def test_an_empty_feed_lists_nothing(self) -> None:
        response = client.get("/api/notifications")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"notifications": []})

    def test_posting_a_toast_records_it_as_client_sourced(self) -> None:
        response = client.post(
            "/api/notifications", json={"message": "Folder path copied.", "variant": "success"}
        )

        self.assertEqual(response.status_code, 200)
        created = response.json()
        self.assertEqual(created["source"], "client")
        self.assertEqual(created["count"], 1)
        self.assertIsNone(created["read_at"])

        listed = client.get("/api/notifications").json()["notifications"]
        self.assertEqual([row["message"] for row in listed], ["Folder path copied."])

    def test_the_feed_reads_newest_first(self) -> None:
        for message in ("First.", "Second.", "Third."):
            client.post("/api/notifications", json={"message": message, "variant": "success"})

        listed = client.get("/api/notifications").json()["notifications"]

        self.assertEqual([row["message"] for row in listed], ["Third.", "Second.", "First."])

    def test_a_blank_message_is_rejected(self) -> None:
        response = client.post("/api/notifications", json={"message": "   ", "variant": "success"})

        self.assertEqual(response.status_code, 422)

    def test_an_empty_message_is_rejected(self) -> None:
        response = client.post("/api/notifications", json={"message": "", "variant": "success"})

        self.assertEqual(response.status_code, 422)

    def test_an_unknown_variant_is_rejected(self) -> None:
        response = client.post("/api/notifications", json={"message": "Hi.", "variant": "info"})

        self.assertEqual(response.status_code, 422)

    def test_marking_read_returns_the_stamped_feed(self) -> None:
        client.post("/api/notifications", json={"message": "First.", "variant": "success"})

        response = client.post("/api/notifications/read")

        self.assertEqual(response.status_code, 200)
        rows = response.json()["notifications"]
        self.assertTrue(all(row["read_at"] for row in rows))

    def test_clearing_empties_the_feed(self) -> None:
        client.post("/api/notifications", json={"message": "First.", "variant": "success"})

        response = client.delete("/api/notifications")

        self.assertEqual(response.json(), {"notifications": []})
        self.assertEqual(client.get("/api/notifications").json()["notifications"], [])


class NotificationBroadcastTests(unittest.TestCase):
    def setUp(self) -> None:
        init_notifications_table()
        clear_notifications_for_tests()

    def test_a_posted_toast_reaches_every_open_tab(self) -> None:
        import asyncio

        async def run() -> dict[str, object]:
            events.clear_subscribers_for_tests()
            with events.subscribe() as subscriber:
                await asyncio.to_thread(
                    client.post,
                    "/api/notifications",
                    json={"message": "Folder path copied.", "variant": "success"},
                )
                frame = await subscriber.next_event(timeout=2)
            assert frame is not None
            return frame

        frame = asyncio.run(run())

        self.assertEqual(frame["type"], "notification")
        notification = frame["notification"]
        assert isinstance(notification, dict)
        self.assertEqual(notification["message"], "Folder path copied.")
        self.assertEqual(notification["source"], "client")


if __name__ == "__main__":
    unittest.main()
