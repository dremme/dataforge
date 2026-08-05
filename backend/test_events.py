"""Tests for the SSE fan-out (:mod:`events`) and the AI-Toolkit feed."""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

import events
from external_jobs_feed import run_external_jobs_feed


class EventFanOutTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        events.clear_subscribers_for_tests()

    async def test_publish_reaches_every_subscriber(self) -> None:
        with events.subscribe() as first, events.subscribe() as second:
            events.publish({"type": "job", "job": {"id": "job-1"}})

            self.assertEqual(await first.next_event(1.0), {"type": "job", "job": {"id": "job-1"}})
            self.assertEqual(await second.next_event(1.0), {"type": "job", "job": {"id": "job-1"}})

    async def test_publish_from_a_worker_thread_reaches_the_loop(self) -> None:
        """Jobs run on threads; the stream lives on the loop."""
        with events.subscribe() as subscriber:
            await asyncio.to_thread(events.publish, {"type": "job", "job": {"id": "job-1"}})

            event = await subscriber.next_event(1.0)
            self.assertEqual(event, {"type": "job", "job": {"id": "job-1"}})

    async def test_a_stalled_subscriber_drops_its_oldest_events(self) -> None:
        """A client that stops reading must never hold up a worker."""
        overflow = 10

        with events.subscribe() as subscriber:
            for index in range(events.MAX_QUEUED_EVENTS + overflow):
                events.publish({"type": "job", "index": index})
            await asyncio.sleep(0.05)

            event = await subscriber.next_event(1.0)
            self.assertIsNotNone(event)
            # The oldest were dropped, so the queue starts at the overflow point.
            self.assertEqual(event["index"], overflow)  # type: ignore[index]

    async def test_next_event_gives_up_so_the_stream_can_send_a_heartbeat(self) -> None:
        with events.subscribe() as subscriber:
            self.assertIsNone(await subscriber.next_event(0.01))

    async def test_publishing_with_nobody_listening_is_a_no_op(self) -> None:
        events.publish({"type": "job", "job": {"id": "job-1"}})
        self.assertEqual(events.subscriber_count(), 0)

    async def test_a_closed_subscription_stops_receiving(self) -> None:
        with events.subscribe() as subscriber:
            pass

        events.publish({"type": "job", "job": {"id": "job-1"}})
        self.assertIsNone(await subscriber.next_event(0.01))


class ExternalJobsFeedTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        events.clear_subscribers_for_tests()

    async def _run_feed(self):
        task = asyncio.create_task(run_external_jobs_feed())
        self.addCleanup(task.cancel)
        return task

    async def test_publishes_a_change_once_and_stays_quiet_after(self) -> None:
        with (
            events.subscribe() as subscriber,
            patch("external_jobs_feed.fetch_active_ostris_jobs", return_value=([], True)),
            patch("external_jobs_feed.POLL_INTERVAL_SECONDS", 0.01),
        ):
            await self._run_feed()

            event = await subscriber.next_event(2.0)
            self.assertIsNotNone(event)
            self.assertEqual(event["type"], "external_jobs")  # type: ignore[index]
            self.assertEqual(event["available"], True)  # type: ignore[index]

            # Nothing changed, so the feed has nothing more to say.
            self.assertIsNone(await subscriber.next_event(0.2))

    async def test_does_not_poll_ai_toolkit_while_nobody_is_listening(self) -> None:
        with (
            patch("external_jobs_feed.fetch_active_ostris_jobs", return_value=([], True)) as fetch,
            patch("external_jobs_feed.IDLE_INTERVAL_SECONDS", 0.01),
        ):
            await self._run_feed()
            await asyncio.sleep(0.1)

            fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
