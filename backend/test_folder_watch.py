import asyncio
import unittest
from unittest.mock import patch

import events
import folder_watch
from folder_watch import run_folder_watch_feed


class WatchRegistryTests(unittest.IsolatedAsyncioTestCase):
    """`events.subscribe` binds to the running loop, so these need one too."""

    async def asyncSetUp(self) -> None:
        folder_watch.clear_watches_for_tests()
        events.clear_subscribers_for_tests()
        self.addCleanup(folder_watch.clear_watches_for_tests)

    async def test_a_tab_without_a_live_stream_watches_nothing(self) -> None:
        folder_watch.touch("tab-a", "C:\\Photos")

        # No live stream: scanning would be work nobody can receive.
        self.assertEqual(folder_watch.watchers_by_folder(), {})

    async def test_paths_differing_only_in_case_or_separator_are_one_folder(self) -> None:
        with _fake_subscriber("tab-a"), _fake_subscriber("tab-b"):
            folder_watch.touch("tab-a", "C:\\Photos")
            folder_watch.touch("tab-b", "c:/photos")

            watchers = folder_watch.watchers_by_folder()

            # One entry, or the same directory would be scanned twice a tick.
            self.assertEqual(len(watchers), 1)
            self.assertEqual(next(iter(watchers.values())), {"tab-a", "tab-b"})

    async def test_folders_differing_by_more_than_case_stay_separate(self) -> None:
        # Full case folding maps "ß" onto "ss", which would make these one key.
        with _fake_subscriber("tab-a"), _fake_subscriber("tab-b"):
            folder_watch.touch("tab-a", "C:\\Stra\u00dfe")
            folder_watch.touch("tab-b", "C:\\Strasse")

            self.assertEqual(len(folder_watch.watchers_by_folder()), 2)

    async def test_keying_an_already_keyed_path_changes_nothing(self) -> None:
        # The published path is the key, and a client may well send it back.
        key = folder_watch.watch_key("C:/Photos/")
        self.assertEqual(folder_watch.watch_key(key), key)

    async def test_a_blank_path_is_not_watched(self) -> None:
        with _fake_subscriber("tab-a"):
            folder_watch.touch("tab-a", "   ")

            self.assertEqual(folder_watch.watchers_by_folder(), {})

    async def test_an_entry_expires_once_its_tab_stops_mentioning_it(self) -> None:
        with _fake_subscriber("tab-a"):
            folder_watch.touch("tab-a", "C:\\Photos")

            with patch("folder_watch.WATCH_TTL_SECONDS", -1.0):
                self.assertEqual(folder_watch.watchers_by_folder(), {})

    async def test_a_tab_keeps_only_its_most_recent_folders(self) -> None:
        with _fake_subscriber("tab-a"):
            for index in range(folder_watch.MAX_FOLDERS_PER_TAB + 2):
                folder_watch.touch("tab-a", f"C:\\Photos\\{index}")

            self.assertEqual(
                len(folder_watch.watchers_by_folder()), folder_watch.MAX_FOLDERS_PER_TAB
            )


class FolderWatchFeedTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        events.clear_subscribers_for_tests()
        folder_watch.clear_watches_for_tests()
        self.addCleanup(folder_watch.clear_watches_for_tests)

    async def _run_feed(self):
        task = asyncio.create_task(run_folder_watch_feed())
        self.addCleanup(task.cancel)
        return task

    async def test_publishes_a_change_once_and_stays_quiet_after(self) -> None:
        with (
            events.subscribe("tab-a") as subscriber,
            patch("folder_watch.compute_folder_fingerprint", return_value="fp-1"),
            patch("folder_watch.MIN_INTERVAL_SECONDS", 0.01),
        ):
            folder_watch.touch("tab-a", "C:\\Photos")
            await self._run_feed()

            event = await subscriber.next_event(2.0)
            self.assertIsNotNone(event)
            self.assertEqual(event["type"], "folder")  # type: ignore[index]
            self.assertEqual(event["fingerprint"], "fp-1")  # type: ignore[index]

            # The fingerprint has not moved, so there is nothing more to say.
            self.assertIsNone(await subscriber.next_event(0.2))

    async def test_does_not_scan_while_nothing_is_watched(self) -> None:
        with (
            patch("folder_watch.compute_folder_fingerprint") as scan,
            patch("folder_watch.IDLE_INTERVAL_SECONDS", 0.01),
        ):
            await self._run_feed()
            await asyncio.sleep(0.1)

            scan.assert_not_called()

    async def test_an_unreadable_folder_is_reported_once_not_every_pass(self) -> None:
        with (
            events.subscribe("tab-a") as subscriber,
            patch("folder_watch.compute_folder_fingerprint", return_value=None),
            patch("folder_watch.MIN_INTERVAL_SECONDS", 0.01),
        ):
            folder_watch.touch("tab-a", "C:\\Gone")
            await self._run_feed()

            event = await subscriber.next_event(2.0)
            self.assertIsNotNone(event)
            self.assertEqual(event["fingerprint"], folder_watch.UNREADABLE_FINGERPRINT)  # type: ignore[index]

            self.assertIsNone(await subscriber.next_event(0.2))

    async def test_a_failing_scan_does_not_kill_the_feed(self) -> None:
        fingerprints = [OSError("drive gone"), "fp-1"]

        def scan(_folder):
            result = fingerprints.pop(0) if fingerprints else "fp-1"
            if isinstance(result, Exception):
                raise result
            return result

        with (
            events.subscribe("tab-a") as subscriber,
            patch("folder_watch.compute_folder_fingerprint", side_effect=scan),
            patch("folder_watch.MIN_INTERVAL_SECONDS", 0.01),
            patch("folder_watch.BACKOFF_SECONDS", 0.01),
        ):
            folder_watch.touch("tab-a", "C:\\Photos")
            await self._run_feed()

            event = await subscriber.next_event(2.0)
            self.assertIsNotNone(event)
            self.assertEqual(event["fingerprint"], "fp-1")  # type: ignore[index]

    async def test_two_tabs_on_different_folders_each_get_only_their_own(self) -> None:
        def scan(folder):
            return f"fp-{folder}"

        with (
            events.subscribe("tab-a") as first,
            events.subscribe("tab-b") as second,
            patch("folder_watch.compute_folder_fingerprint", side_effect=scan),
            patch("folder_watch.MIN_INTERVAL_SECONDS", 0.01),
        ):
            folder_watch.touch("tab-a", "C:\\Photos")
            folder_watch.touch("tab-b", "C:\\Videos")
            await self._run_feed()

            first_event = await first.next_event(2.0)
            second_event = await second.next_event(2.0)

            self.assertIsNotNone(first_event)
            self.assertIsNotNone(second_event)
            # Paths are published in the folded form the watcher keys on.
            self.assertTrue(first_event["path"].endswith("photos"))  # type: ignore[index]
            self.assertTrue(second_event["path"].endswith("videos"))  # type: ignore[index]

            # Neither tab is told about the other's folder.
            self.assertIsNone(await first.next_event(0.2))
            self.assertIsNone(await second.next_event(0.2))

    async def test_two_tabs_on_one_folder_share_a_single_scan(self) -> None:
        with (
            events.subscribe("tab-a") as first,
            events.subscribe("tab-b") as second,
            patch("folder_watch.compute_folder_fingerprint", return_value="fp-1") as scan,
            patch("folder_watch.MIN_INTERVAL_SECONDS", 0.01),
        ):
            folder_watch.touch("tab-a", "C:\\Photos")
            folder_watch.touch("tab-b", "C:\\Photos")
            await self._run_feed()

            self.assertIsNotNone(await first.next_event(2.0))
            self.assertIsNotNone(await second.next_event(2.0))

            # Both were told, but the directory was read once.
            self.assertEqual(scan.call_count, 1)

    async def test_job_events_still_reach_every_tab(self) -> None:
        with events.subscribe("tab-a") as first, events.subscribe("tab-b") as second:
            events.publish({"type": "job", "job": {"id": "job-1"}})

            self.assertIsNotNone(await first.next_event(1.0))
            self.assertIsNotNone(await second.next_event(1.0))


def _fake_subscriber(tab_id: str):
    """A live stream for ``tab_id``, so the registry counts it as connected."""
    return events.subscribe(tab_id)


if __name__ == "__main__":
    unittest.main()
