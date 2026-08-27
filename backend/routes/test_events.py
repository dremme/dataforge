from __future__ import annotations

import asyncio
import json
import unittest
from time import monotonic
from unittest.mock import patch
from urllib.parse import quote

import events
from routes._test_client import client
from routes.events import stream_events
from testing_fixtures import (
    TempMediaFolder,
    reset_job_manager,
    write_media,
    write_sysprompt,
    write_txt_caption,
)

CAPTION = (
    "A red car is parked on a gravel driveway beside a low stone wall, with a row of "
    "birch trees behind it and a wooden gate standing open at the far end. Late "
    "afternoon light rakes across the gravel and throws long shadows toward the "
    "camera, and a bicycle leans against the wall on the left."
)


async def _await_terminal_job_event(subscriber, job_id: str, timeout: float = 10.0):
    """The first pushed snapshot of ``job_id`` that has left the active statuses."""
    deadline = monotonic() + timeout

    while monotonic() < deadline:
        event = await subscriber.next_event(1.0)
        if event is None or event.get("type") != "job":
            continue

        job = event["job"]
        if job["id"] == job_id and job["status"] not in {"queued", "running"}:
            return job

    return None


class JobEventTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        reset_job_manager()
        events.clear_subscribers_for_tests()

    async def test_a_job_pushes_its_progress_without_being_polled(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            with (
                events.subscribe() as subscriber,
                patch("automation.auto_caption.complete_caption", return_value=CAPTION),
            ):
                started = await asyncio.to_thread(
                    client.post, f"/api/automation/auto-caption?path={quote(str(root))}"
                )
                job_id = started.json()["id"]

                job = await _await_terminal_job_event(subscriber, job_id)

            self.assertIsNotNone(job)
            self.assertEqual(job["status"], "completed")  # type: ignore[index]
            self.assertEqual(job["processed"], 1)  # type: ignore[index]
            # Results ride their own endpoint; they must never be pushed.
            self.assertNotIn("results", job)  # type: ignore[operator]


class EventStreamTests(unittest.IsolatedAsyncioTestCase):
    """Drives the response generator directly; a test client would hang on the infinite stream."""

    async def asyncSetUp(self) -> None:
        events.clear_subscribers_for_tests()

    async def test_stream_announces_itself_then_carries_events(self) -> None:
        response = await stream_events()
        self.assertTrue(response.media_type.startswith("text/event-stream"))
        self.assertEqual(response.headers["cache-control"], "no-store")

        frames = response.body_iterator
        self.addCleanup(lambda: asyncio.ensure_future(frames.aclose()))

        # The comment lands before any event, so a client knows the stream is live.
        self.assertEqual(await anext(frames), ": connected\n\n")

        events.publish({"type": "job", "job": {"id": "job-1"}})
        frame = await anext(frames)
        self.assertEqual(
            json.loads(frame.removeprefix("data: ")), {"type": "job", "job": {"id": "job-1"}}
        )

    async def test_an_idle_stream_sends_a_heartbeat_instead_of_closing(self) -> None:
        with patch("routes.events.HEARTBEAT_SECONDS", 0.01):
            response = await stream_events()
            frames = response.body_iterator
            self.addCleanup(lambda: asyncio.ensure_future(frames.aclose()))

            self.assertEqual(await anext(frames), ": connected\n\n")
            # A data frame, not a comment: comments never reach ``onmessage``.
            frame = await anext(frames)
            self.assertEqual(json.loads(frame.removeprefix("data: ")), {"type": "heartbeat"})

    async def test_folder_events_only_reach_the_tab_that_asked_for_that_folder(self) -> None:
        response = await stream_events(tab="tab-a")
        frames = response.body_iterator
        self.addCleanup(lambda: asyncio.ensure_future(frames.aclose()))
        self.assertEqual(await anext(frames), ": connected\n\n")

        events.publish_to_tabs(["tab-b"], {"type": "folder", "path": "C:\\Other"})
        events.publish_to_tabs(["tab-a"], {"type": "folder", "path": "C:\\Photos"})

        # The first frame is the one addressed here; the other tab's event was never queued.
        frame = await anext(frames)
        self.assertEqual(
            json.loads(frame.removeprefix("data: ")),
            {"type": "folder", "path": "C:\\Photos"},
        )


if __name__ == "__main__":
    unittest.main()
