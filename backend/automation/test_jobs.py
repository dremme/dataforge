from __future__ import annotations

import unittest
import uuid
from dataclasses import replace
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation import jobs_store
from automation.jobs import JOB_SPECS, Job, job_manager
from automation.jobs_store import get_job as get_job_from_store
from notifications_store import (
    clear_notifications_for_tests,
    init_notifications_table,
    list_notifications,
)
from testing_fixtures import (
    TempMediaFolder,
    reset_job_manager,
    wait_for_job,
    write_media,
    write_mp4_video,
    write_sysprompt,
    write_txt_caption,
)


class JobManagerQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_queue_auto_caption_persists_queued_job(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch("automation.auto_caption.complete_caption", return_value=None):
                job = job_manager.queue_job("auto_caption", root, mode="instruct")

            self.assertIn(job.status, {"queued", "running"})
            self.assertEqual(job.job_type, "auto_caption")
            self.assertEqual(job.auto_caption_mode, "instruct")

            stored = get_job_from_store(job.id)
            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored["folder"], str(root.resolve()))
            self.assertEqual(stored.get("auto_caption_mode"), "instruct")

    def test_rejects_second_active_job_for_same_folder(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")
            folder = str(root.resolve())

            with job_manager._lock:
                job_manager._jobs["running-test"] = Job(
                    id="running-test",
                    folder=folder,
                    status="running",
                )

            with self.assertRaisesRegex(ValueError, "already running"):
                job_manager.queue_job("strip_metadata", root)

    def test_get_active_job_for_folder_prefers_memory(self) -> None:
        with TempMediaFolder() as root:
            folder = str(root.resolve())
            active = Job(id="active-1", folder=folder, status="running", job_type="strip_metadata")

            with job_manager._lock:
                job_manager._jobs[active.id] = active

            found = job_manager.get_active_job_for_folder(folder)
            self.assertIsNotNone(found)
            assert found is not None
            self.assertEqual(found.id, "active-1")

    def test_the_latest_job_for_a_folder_is_the_newer_of_memory_and_store(self) -> None:
        with TempMediaFolder() as root:
            folder = str(root.resolve())
            older = Job(id="older", folder=folder, created_at="2026-01-01T00:00:00+00:00")
            newer = Job(id="newer", folder=folder, created_at="2026-01-02T00:00:00+00:00")
            jobs_store.save_job(older.to_dict())

            stored_only = job_manager.get_latest_job_for_folder(folder)
            jobs_store.save_job(newer.to_dict())
            with job_manager._lock:
                job_manager._jobs[older.id] = older
            store_is_newer = job_manager.get_latest_job_for_folder(folder)

        self.assertEqual(getattr(stored_only, "id", None), "older")
        self.assertEqual(getattr(store_is_newer, "id", None), "newer")


def _with_runner(job_type: str, run):
    return patch.dict(JOB_SPECS, {job_type: replace(JOB_SPECS[job_type], run=run)})


class JobManagerExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_a_runner_that_raises_fails_the_job_with_its_message(self) -> None:
        def boom(_folder, **_params):
            raise RuntimeError("AI-Toolkit refused the job")

        with TempMediaFolder() as root, _with_runner("strip_metadata", boom):
            write_media(root, "photo.png")

            finished = wait_for_job(job_manager.queue_job("strip_metadata", root).id)

        self.assertEqual(finished.status, "failed")
        self.assertEqual(finished.error, "AI-Toolkit refused the job")

    def test_startup_reattaches_to_a_training_run_left_active(self) -> None:
        received: dict[str, object] = {}

        def attach(folder, **params):
            received.update(params)
            return {"folder": str(folder), "total": 0, "processed": 0, "stats": {}, "results": []}

        with TempMediaFolder() as root, _with_runner("train_lora", attach):
            left = Job(
                id="left-running",
                folder=str(root.resolve()),
                status="running",
                job_type="train_lora",
                external_ref="sample_train_v1",
            )
            jobs_store.save_job(left.to_dict())

            job_manager.initialize()
            finished = wait_for_job(left.id)

        self.assertEqual(finished.status, "completed")
        self.assertEqual(received["lora_name"], "sample_train_v1")
        self.assertIs(received["attach_only"], True)

    def test_auto_caption_api_errors_mark_job_failed(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch("automation.auto_caption.complete_caption", return_value=None):
                job = job_manager.queue_job("auto_caption", root, mode="thinking")
                finished = wait_for_job(job.id)

            self.assertEqual(finished.status, "failed")
            self.assertEqual(finished.stats.get("api_error"), 1)
            self.assertIn("Failed auto-caption", finished.error or "")
            self.assertEqual(finished.auto_caption_mode, "thinking")

            stored = get_job_from_store(job.id)
            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored["status"], "failed")

    def test_strip_metadata_job_completes_for_png(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", text_chunks={"comment": "secret"})

            job = job_manager.queue_job("strip_metadata", root)
            finished = wait_for_job(job.id)

            self.assertEqual(finished.job_type, "strip_metadata")
            self.assertEqual(finished.status, "completed")
            self.assertEqual(finished.stats.get("success"), 1)

    def test_strip_metadata_job_reports_ffmpeg_errors(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4", metadata={"comment": "secret"})

            with patch(
                "automation.strip_metadata.strip_isobmff_metadata",
                side_effect=RuntimeError("ffmpeg failed to strip video metadata"),
            ):
                job = job_manager.queue_job("strip_metadata", root)
                finished = wait_for_job(job.id)

            self.assertEqual(finished.status, "failed")
            self.assertIn("ffmpeg", (finished.error or "").lower())

    def test_set_captions_job_writes_sidecars(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "one.png")
            second = write_media(root, "two.png")

            job = job_manager.queue_job(
                "set_captions", root, caption="Shared caption.", overwrite=True
            )
            finished = wait_for_job(job.id)

            self.assertEqual(finished.status, "completed")
            self.assertEqual(finished.stats.get("success"), 2)
            self.assertEqual(
                first.with_suffix(".txt").read_text(encoding="utf-8").strip(),
                "Shared caption.",
            )
            self.assertEqual(
                second.with_suffix(".txt").read_text(encoding="utf-8").strip(),
                "Shared caption.",
            )


class JobManagerLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_cancel_job_sets_cancel_flag_for_active_job(self) -> None:
        import threading

        job_id = "cancel-me"
        cancel_event = threading.Event()
        with job_manager._lock:
            job_manager._jobs[job_id] = Job(
                id=job_id,
                folder="/tmp/folder",
                status="running",
            )
            job_manager._cancel_flags[job_id] = cancel_event

        cancelled = job_manager.cancel_job(job_id)

        self.assertIsNotNone(cancelled)
        self.assertTrue(cancel_event.is_set())

    def test_delete_job_removes_memory_and_store(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            with patch("automation.auto_caption.complete_caption", return_value=None):
                job = job_manager.queue_job("auto_caption", root, mode="thinking")
                wait_for_job(job.id)

            self.assertTrue(job_manager.delete_job(job.id))
            self.assertIsNone(job_manager.get_job(job.id))
            self.assertIsNone(get_job_from_store(job.id))

    def test_delete_all_jobs_clears_persisted_jobs(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", text_chunks={"comment": "secret"})

            job = job_manager.queue_job("strip_metadata", root)
            wait_for_job(job.id)

            deleted_count = job_manager.delete_all_jobs()
            self.assertGreaterEqual(deleted_count, 1)
            self.assertEqual(job_manager.list_jobs(), [])


def _revision(record: dict[str, object]) -> int:
    revision = record["revision"]
    assert isinstance(revision, int)
    return revision


class JobRevisionTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()
        self.job = Job(id=uuid.uuid4().hex, folder=r"C:\Photos")
        with job_manager._lock:
            job_manager._jobs[self.job.id] = self.job
        publish = patch("automation.jobs.events.publish")
        self.published = publish.start()
        self.addCleanup(publish.stop)

    def _save(self, **changes: object) -> None:
        for name, value in changes.items():
            setattr(self.job, name, value)
        with job_manager._lock:
            job_manager._save_snapshot(self.job.id, self.job.to_dict())

    def _pushed(self, event_type: str) -> list[dict[str, object]]:
        return [
            call.args[0]
            for call in self.published.call_args_list
            if call.args[0]["type"] == event_type
        ]

    def test_every_save_stamps_a_higher_revision_and_stores_it(self) -> None:
        self._save(status="queued")
        first = self.job.revision
        self._save(status="running")

        self.assertGreater(self.job.revision, first)
        stored = get_job_from_store(self.job.id)
        assert stored is not None
        self.assertEqual(stored["revision"], self.job.revision)
        self.assertEqual(self._pushed("job")[-1]["job"]["revision"], self.job.revision)

    def test_the_list_snapshot_revision_is_above_every_saved_job(self) -> None:
        self._save(status="running")

        self.assertGreater(job_manager.snapshot_revision(), self.job.revision)

    def test_thinned_progress_is_neither_stored_nor_pushed_but_listed_from_memory(self) -> None:
        self._save(status="running", processed=0)
        pushed_before = len(self._pushed("job"))

        with patch("automation.jobs.JOB_EVENT_MIN_INTERVAL_SECONDS", 60):
            self._save(processed=5)

        stored = get_job_from_store(self.job.id)
        assert stored is not None
        self.assertEqual(stored["processed"], 0)
        self.assertEqual(len(self._pushed("job")), pushed_before)
        listed = next(job for job in job_manager.list_jobs() if job.id == self.job.id)
        self.assertEqual(listed.processed, 5)
        self.assertGreater(listed.revision, _revision(stored))

    def test_a_status_change_is_stored_inside_the_thinning_interval(self) -> None:
        self._save(status="running")

        with patch("automation.jobs.JOB_EVENT_MIN_INTERVAL_SECONDS", 60):
            self._save(status="completed")

        stored = get_job_from_store(self.job.id)
        assert stored is not None
        self.assertEqual(stored["status"], "completed")
        self.assertEqual(self._pushed("job")[-1]["job"]["status"], "completed")

    def test_deleting_a_job_pushes_its_id_with_a_newer_revision(self) -> None:
        self._save(status="completed")

        self.assertTrue(job_manager.delete_job(self.job.id))

        [removed] = self._pushed("jobs_removed")
        self.assertEqual(removed["ids"], [self.job.id])
        self.assertGreater(_revision(removed), self.job.revision)

    def test_deleting_every_job_pushes_every_id(self) -> None:
        self._save(status="completed")
        save_job_row = {**self.job.to_dict(), "id": "stored-only", "status": "completed"}
        jobs_store.save_job(save_job_row)

        job_manager.delete_all_jobs()

        [removed] = self._pushed("jobs_removed")
        self.assertCountEqual(removed["ids"], [self.job.id, "stored-only"])

    def test_pruning_pushes_the_pruned_ids(self) -> None:
        self._save(status="completed", finished_at="2000-01-01T00:00:00+00:00")

        self.assertEqual(job_manager.prune_finished(1), 1)

        [removed] = self._pushed("jobs_removed")
        self.assertEqual(removed["ids"], [self.job.id])

    def test_deleting_nothing_pushes_nothing(self) -> None:
        with job_manager._lock:
            job_manager._jobs.clear()

        job_manager.delete_all_jobs()
        job_manager.prune_finished(1)

        self.assertEqual(self._pushed("jobs_removed"), [])

    def test_recovering_stale_jobs_stamps_a_newer_revision(self) -> None:
        """A tab holding the pre-restart "running" frame must not outrank the recovered row."""
        self._save(status="running")

        jobs_store.recover_stale_jobs()

        stored = get_job_from_store(self.job.id)
        assert stored is not None
        self.assertEqual(stored["status"], "interrupted")
        self.assertGreater(_revision(stored), self.job.revision)


class JobOutcomeNotificationTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()
        init_notifications_table()
        clear_notifications_for_tests()
        # Deleted ids are never written again, so each test needs a job id of its own.
        self.job_id = uuid.uuid4().hex

    def _snapshot(self, status: str) -> dict[str, object]:
        return {
            "id": self.job_id,
            "folder": r"C:\Photos",
            "folder_name": "Photos",
            "job_type": "auto_caption",
            "status": status,
            "total": 3,
            "processed": 3,
            "stats": {"success": 3},
            "created_at": "2026-01-01T00:00:00.000Z",
        }

    def _publish(self, status: str) -> None:
        with job_manager._lock:
            job_manager._jobs.setdefault(self.job_id, Job(id=self.job_id, folder=r"C:\Photos"))
            job_manager._save_snapshot(self.job_id, self._snapshot(status))

    def test_reaching_a_terminal_status_records_one_notification(self) -> None:
        self._publish("running")
        self._publish("completed")

        stored = list_notifications()
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["message"], 'Auto-caption completed in "Photos".')
        self.assertEqual(stored[0]["source"], "job")
        self.assertEqual(stored[0]["job_id"], self.job_id)

    def test_republishing_the_same_terminal_status_records_nothing_further(self) -> None:
        self._publish("running")
        self._publish("completed")

        with patch("automation.jobs.JOB_EVENT_MIN_INTERVAL_SECONDS", 0):
            self._publish("completed")
            self._publish("completed")

        self.assertEqual(len(list_notifications()), 1)

    def test_a_job_whose_first_snapshot_is_terminal_announces_nothing(self) -> None:
        self._publish("completed")

        self.assertEqual(list_notifications(), [])

    def test_progress_transitions_announce_nothing(self) -> None:
        self._publish("queued")
        self._publish("running")

        self.assertEqual(list_notifications(), [])

    def test_a_finished_job_survives_the_feed_being_unwritable(self) -> None:
        self._publish("running")

        with patch(
            "notifications.record_notification", side_effect=RuntimeError("database is locked")
        ):
            self._publish("completed")

        self.assertEqual(list_notifications(), [])


if __name__ == "__main__":
    unittest.main()
