from __future__ import annotations

import asyncio
import unittest
from typing import cast
from unittest.mock import patch

import events
from external_jobs_feed import (
    observe_external_jobs,
    read_external_jobs,
    reset_external_jobs_for_tests,
    run_external_jobs_feed,
)


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

            # The loss is announced first, then the queue resumes at the overflow point.
            self.assertEqual(await subscriber.next_event(1.0), {"type": "resync"})
            event = await subscriber.next_event(1.0)
            self.assertIsNotNone(event)
            self.assertEqual(event["index"], overflow)

    async def test_resync_is_announced_once_per_loss(self) -> None:
        with events.subscribe() as subscriber:
            for index in range(events.MAX_QUEUED_EVENTS + 1):
                events.publish({"type": "job", "index": index})
            await asyncio.sleep(0.05)

            frames = [await subscriber.next_event(0.1) for _ in range(events.MAX_QUEUED_EVENTS + 1)]
            self.assertEqual(sum(frame == {"type": "resync"} for frame in frames), 1)
            self.assertIsNone(await subscriber.next_event(0.01))

    async def test_a_subscriber_that_keeps_up_never_sees_a_resync(self) -> None:
        with events.subscribe() as subscriber:
            events.publish({"type": "job", "index": 0})
            self.assertEqual(await subscriber.next_event(1.0), {"type": "job", "index": 0})
            self.assertIsNone(await subscriber.next_event(0.01))

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
        reset_external_jobs_for_tests()

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
            self.assertEqual(event["type"], "external_jobs")
            self.assertEqual(event["available"], True)

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


class ExternalJobsSnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        events.clear_subscribers_for_tests()
        reset_external_jobs_for_tests()

    async def test_the_revision_moves_only_when_the_content_changes(self) -> None:
        first = observe_external_jobs([], True)
        same = observe_external_jobs([], True)
        changed = observe_external_jobs([], False)

        self.assertEqual(same["revision"], first["revision"])
        self.assertGreater(cast(int, changed["revision"]), cast(int, first["revision"]))

    async def test_a_change_seen_by_a_rest_read_is_pushed_to_listeners(self) -> None:
        """Otherwise the feed's next poll matches the snapshot and nobody else hears of it."""
        with (
            events.subscribe() as subscriber,
            patch("external_jobs_feed.fetch_active_ostris_jobs", return_value=([], True)),
        ):
            snapshot = await asyncio.to_thread(read_external_jobs)

            self.assertEqual(await subscriber.next_event(1.0), snapshot)

    async def test_a_fresh_snapshot_is_served_without_asking_ai_toolkit_again(self) -> None:
        with patch("external_jobs_feed.fetch_active_ostris_jobs", return_value=([], True)) as fetch:
            first = read_external_jobs()
            second = read_external_jobs()

        self.assertEqual(fetch.call_count, 1)
        self.assertIs(second, first)

    async def test_a_stale_snapshot_is_read_again(self) -> None:
        with (
            patch("external_jobs_feed.fetch_active_ostris_jobs", return_value=([], True)) as fetch,
            patch("external_jobs_feed.POLL_INTERVAL_SECONDS", 0),
        ):
            read_external_jobs()
            read_external_jobs()

        self.assertEqual(fetch.call_count, 2)


if __name__ == "__main__":
    unittest.main()
