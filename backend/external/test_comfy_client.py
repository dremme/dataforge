import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from external.comfy_client import (
    ComfyPromptError,
    ComfyUnavailableError,
    comfy_url,
    delete_queued,
    download_view,
    fetch_history,
    fetch_queue,
    history_error_text,
    history_is_finished,
    history_outputs,
    interrupt,
    submit_prompt,
    upload_image,
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
        # Some builds report a rejected graph as a 200 carrying node_errors. Trusting the
        # status code alone would have the job wait out its whole timeout on a prompt
        # that was never queued.
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

    def test_a_video_only_output_reports_nothing(self) -> None:
        # "gifs"/"videos" are a separate contract; reporting no output is the honest
        # answer for a still workflow rather than a partial guess.
        entry = {"outputs": {"3": {"gifs": [{"filename": "out.mp4"}]}}}

        self.assertEqual(history_outputs(entry), [])

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
                    upload_image(client, source, name="job_00001.png"),
                    "dataforge/job_00001.png",
                )

    def test_an_upload_without_a_subfolder_is_the_bare_name(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"name": "photo.png", "subfolder": ""})

        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "photo.png"
            source.write_bytes(b"pixels")

            with client_for(handler) as client:
                self.assertEqual(upload_image(client, source, name="photo.png"), "photo.png")

    def test_the_view_params_are_passed_straight_through(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["params"] = dict(request.url.params)
            return httpx.Response(200, content=b"image-bytes")

        ref = {"filename": "a.png", "subfolder": "DataForge", "type": "temp"}
        with client_for(handler) as client:
            self.assertEqual(download_view(client, ref), b"image-bytes")

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
