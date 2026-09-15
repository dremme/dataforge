import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from external.comfy_client import (
    ComfyError,
    ComfyPromptError,
    ComfyUnavailableError,
    comfy_url,
    delete_queued,
    download_view_to,
    fetch_history,
    fetch_queue,
    fetch_raw_log_entries,
    history_error_text,
    history_is_finished,
    history_outputs,
    interrupt,
    read_log_lines,
    submit_prompt,
    upload_media,
)


def client_for(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def refusing_client() -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    return client_for(handler)


class SubmitPromptTests(unittest.TestCase):
    def test_a_queued_prompt_returns_its_id(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={"prompt_id": "p-1", "node_errors": {}})

        with client_for(handler) as client:
            self.assertEqual(submit_prompt(client, {"1": {}}, client_id="c-1"), "p-1")

        self.assertEqual(captured["body"]["client_id"], "c-1")
        self.assertEqual(captured["body"]["prompt"], {"1": {}})

    def test_node_errors_on_a_200_are_still_a_rejection(self) -> None:
        # Some builds report a rejected graph as a 200 with node_errors; do not wait on that.
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "prompt_id": "p-1",
                    "node_errors": {"4": {"errors": [{"message": "Model not found"}]}},
                },
            )

        with client_for(handler) as client, self.assertRaises(ComfyPromptError) as caught:
            submit_prompt(client, {}, client_id="c-1")

        self.assertIn("Model not found", str(caught.exception))

    def test_a_400_reports_the_error_body(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400, json={"error": {"message": "Invalid prompt", "details": "node 4"}}
            )

        with client_for(handler) as client, self.assertRaises(ComfyPromptError) as caught:
            submit_prompt(client, {}, client_id="c-1")

        self.assertIn("Invalid prompt", str(caught.exception))

    def test_a_refused_connection_is_unavailable_not_a_bad_prompt(self) -> None:
        with refusing_client() as client, self.assertRaises(ComfyUnavailableError):
            submit_prompt(client, {}, client_id="c-1")


class HistoryTests(unittest.TestCase):
    def test_an_empty_history_means_still_running(self) -> None:
        with client_for(lambda _r: httpx.Response(200, json={})) as client:
            self.assertIsNone(fetch_history(client, "p-1"))

    def test_a_finished_entry_comes_back(self) -> None:
        entry = {"status": {"completed": True}, "outputs": {}}

        with client_for(lambda _r: httpx.Response(200, json={"p-1": entry})) as client:
            self.assertEqual(fetch_history(client, "p-1"), entry)

    def test_completion_is_read_from_either_shape(self) -> None:
        self.assertTrue(history_is_finished({"status": {"completed": True}}))
        self.assertTrue(history_is_finished({"status": {"status_str": "success"}}))
        self.assertTrue(history_is_finished({"status": {"status_str": "error"}}))
        self.assertFalse(history_is_finished({"status": {"status_str": "running"}}))
        # No status block at all, which older builds emit: outputs prove it finished.
        self.assertTrue(history_is_finished({"outputs": {"3": {}}}))
        self.assertFalse(history_is_finished({"outputs": {}}))

    def test_an_execution_error_is_reported_with_its_node(self) -> None:
        entry = {
            "status": {
                "status_str": "error",
                "messages": [
                    ["execution_start", {}],
                    [
                        "execution_error",
                        {"node_type": "KSampler", "exception_message": "out of memory"},
                    ],
                ],
            }
        }

        self.assertEqual(history_error_text(entry), "KSampler: out of memory")

    def test_a_successful_run_has_no_error_text(self) -> None:
        self.assertIsNone(history_error_text({"status": {"status_str": "success"}}))

    def test_outputs_are_read_from_the_images_key(self) -> None:
        entry = {
            "outputs": {
                "3": {
                    "images": [
                        {"filename": "out_00001_.png", "subfolder": "DataForge", "type": "output"}
                    ]
                }
            }
        }

        self.assertEqual(
            history_outputs(entry),
            [{"filename": "out_00001_.png", "subfolder": "DataForge", "type": "output"}],
        )

    def test_a_video_output_is_reported(self) -> None:
        entry = {"outputs": {"3": {"gifs": [{"filename": "out.mp4"}]}}}

        self.assertEqual(
            history_outputs(entry), [{"filename": "out.mp4", "subfolder": "", "type": "output"}]
        )

    def test_an_output_under_an_unexpected_key_is_still_found(self) -> None:
        # Matched by shape, so a save node filing under a key we have never seen still reports.
        entry = {"outputs": {"3": {"clips": [{"filename": "out.mp4"}]}}}

        self.assertEqual(
            history_outputs(entry), [{"filename": "out.mp4", "subfolder": "", "type": "output"}]
        )

    def test_a_node_id_narrows_the_scan_to_that_node(self) -> None:
        entry = {
            "outputs": {
                "2": {"images": [{"filename": "preview.png", "type": "temp"}]},
                "3": {"gifs": [{"filename": "out.mp4"}]},
            }
        }

        self.assertEqual(
            history_outputs(entry, node_id="3"),
            [{"filename": "out.mp4", "subfolder": "", "type": "output"}],
        )
        self.assertEqual(history_outputs(entry, node_id="9"), [])

    def test_a_missing_subfolder_defaults_to_empty(self) -> None:
        entry = {"outputs": {"3": {"images": [{"filename": "a.png"}]}}}

        self.assertEqual(
            history_outputs(entry), [{"filename": "a.png", "subfolder": "", "type": "output"}]
        )


class TransferTests(unittest.TestCase):
    def test_uploading_returns_the_widget_value_with_its_subfolder(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"name": "job_00001.png", "subfolder": "dataforge"})

        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "photo.png"
            source.write_bytes(b"pixels")

            with client_for(handler) as client:
                self.assertEqual(
                    upload_media(client, source, name="job_00001.png"),
                    "dataforge/job_00001.png",
                )

    def test_an_upload_without_a_subfolder_is_the_bare_name(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"name": "photo.png", "subfolder": ""})

        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "photo.png"
            source.write_bytes(b"pixels")

            with client_for(handler) as client:
                self.assertEqual(upload_media(client, source, name="photo.png"), "photo.png")

    def test_a_video_uploads_under_the_same_multipart_field(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = request.content
            return httpx.Response(200, json={"name": "clip.mp4", "subfolder": "dataforge"})

        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "clip.mp4"
            source.write_bytes(b"moov")

            with client_for(handler) as client:
                self.assertEqual(
                    upload_media(client, source, name="clip.mp4"), "dataforge/clip.mp4"
                )

        self.assertIn(b'name="image"', captured["body"])
        self.assertIn(b"video/mp4", captured["body"])

    def test_a_streamed_download_writes_the_body_to_the_destination(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"clip-bytes")

        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "out.mp4"

            with client_for(handler) as client:
                download_view_to(
                    client, {"filename": "out.mp4", "subfolder": "", "type": "output"}, destination
                )

            self.assertEqual(destination.read_bytes(), b"clip-bytes")

    def test_the_view_params_are_passed_straight_through(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["params"] = dict(request.url.params)
            return httpx.Response(200, content=b"image-bytes")

        ref = {"filename": "a.png", "subfolder": "DataForge", "type": "temp"}
        with tempfile.TemporaryDirectory() as temp, client_for(handler) as client:
            download_view_to(client, ref, Path(temp) / "a.png")

        self.assertEqual(captured["params"], ref)


class QueueTests(unittest.TestCase):
    def test_running_and_pending_ids_are_read_out(self) -> None:
        payload = {
            "queue_running": [[0, "p-running", {}]],
            "queue_pending": [[1, "p-pending", {}], [2, "p-other", {}]],
        }

        with client_for(lambda _r: httpx.Response(200, json=payload)) as client:
            running, pending = fetch_queue(client)

        self.assertEqual(running, ["p-running"])
        self.assertEqual(pending, ["p-pending", "p-other"])

    def test_a_malformed_queue_is_empty_rather_than_a_crash(self) -> None:
        with client_for(lambda _r: httpx.Response(200, json={"queue_running": "?"})) as client:
            self.assertEqual(fetch_queue(client), ([], []))

    def test_deleting_names_the_prompt(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={})

        with client_for(handler) as client:
            delete_queued(client, "p-1")

        self.assertEqual(captured["body"], {"delete": ["p-1"]})

    def test_interrupt_posts_and_survives_an_empty_body(self) -> None:
        with client_for(lambda _r: httpx.Response(200, content=b"")) as client:
            interrupt(client)


class UrlTests(unittest.TestCase):
    def test_paths_join_without_a_double_slash(self) -> None:
        self.assertTrue(comfy_url("/prompt").endswith("/prompt"))
        self.assertEqual(comfy_url("/prompt"), comfy_url("prompt"))
        self.assertNotIn("//prompt", comfy_url("/prompt"))


if __name__ == "__main__":
    unittest.main()


class LogWindowTests(unittest.TestCase):
    def test_the_window_is_read_from_the_internal_path(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["path"] = request.url.path
            return httpx.Response(
                200,
                json={
                    "entries": [{"t": "2026-09-14T18:56:48.651274", "m": "hello\n"}],
                    "size": {"cols": 80, "rows": 24},
                },
            )

        with client_for(handler) as client:
            entries = fetch_raw_log_entries(client)

        self.assertEqual(captured["path"], "/internal/logs/raw")
        self.assertEqual(entries, [{"t": "2026-09-14T18:56:48.651274", "m": "hello\n"}])

    def test_an_older_build_without_the_endpoint_is_unavailable(self) -> None:
        # 404 and a refused connection are the same answer: nobody distinguishes them.
        with client_for(lambda _r: httpx.Response(404)) as client:
            with self.assertRaises(ComfyUnavailableError):
                fetch_raw_log_entries(client)

    def test_a_refused_connection_is_unavailable(self) -> None:
        with refusing_client() as client:
            with self.assertRaises(ComfyUnavailableError):
                fetch_raw_log_entries(client)

    def test_an_unreadable_body_is_not_an_availability_problem(self) -> None:
        with client_for(lambda _r: httpx.Response(200, content=b"not json")) as client:
            with self.assertRaises(ComfyError) as caught:
                fetch_raw_log_entries(client)

        self.assertNotIsInstance(caught.exception, ComfyUnavailableError)

    def test_a_payload_without_entries_reads_as_empty(self) -> None:
        with client_for(lambda _r: httpx.Response(200, json={"size": {}})) as client:
            self.assertEqual(fetch_raw_log_entries(client), [])


class ReadLogLinesTests(unittest.TestCase):
    def test_an_unreachable_comfy_reads_as_none_rather_than_empty(self) -> None:
        """None is "could not read"; [] is "read, nothing there". The panel says different things."""
        with patch(
            "external.comfy_client.fetch_raw_log_entries",
            side_effect=ComfyUnavailableError("down"),
        ):
            self.assertIsNone(read_log_lines())

    def test_the_window_comes_back_assembled(self) -> None:
        entries = [{"m": "phase one"}, {"m": "\n"}]

        with patch("external.comfy_client.fetch_raw_log_entries", return_value=entries):
            self.assertEqual(read_log_lines(), ["phase one"])
