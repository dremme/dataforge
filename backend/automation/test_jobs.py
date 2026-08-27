from __future__ import annotations

import unittest
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from automation.jobs import Job, _resolve_verify_captions_status, job_manager
from automation.jobs_store import get_job as get_job_from_store
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


class JobManagerExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

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
                "automation.strip_metadata.strip_mp4_metadata",
                side_effect=RuntimeError("ffmpeg failed to strip MP4 metadata"),
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

    def test_verify_captions_job_writes_issue_sidecar(self) -> None:
        import json

        from captions import issue_file_path

        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A blue car.")

            response = json.dumps(
                {
                    "correct": False,
                    "issues": 'Replace "blue" with "red". Remove "in the rain".',
                }
            )

            with patch("automation.verify_captions.verify_caption", return_value=response):
                job = job_manager.queue_job("verify_captions", root, mode="instruct", context="")
                finished = wait_for_job(job.id)

            self.assertEqual(finished.status, "completed")
            self.assertEqual(finished.stats.get("issues_found"), 1)
            issue_path = issue_file_path(media)
            self.assertTrue(issue_path.is_file())
            self.assertEqual(
                json.loads(issue_path.read_text(encoding="utf-8")),
                {"fixes": ['Replace "blue" with "red".', 'Remove "in the rain".']},
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


class VerifyCaptionsFailureMessageTests(unittest.TestCase):
    def test_resolve_verify_captions_status_marks_parse_errors_failed(self) -> None:
        job = Job(
            id="job-1",
            folder="/tmp/folder",
            job_type="verify_captions",
            stats={"parse_error": 3},
        )

        status, error = _resolve_verify_captions_status(job, cancelled=False)

        self.assertEqual(status, "failed")
        self.assertIsNotNone(error)
        assert error is not None
        self.assertIn("not valid JSON", error)


if __name__ == "__main__":
    unittest.main()
