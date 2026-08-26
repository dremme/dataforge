import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from PIL import Image

from automation.comfy_process import (
    ComfyProcessCancelled,
    _await_output,
    _request_stop,
    run_comfy_process_job,
    validate_comfy_process_folder,
)
from comfy_candidates import candidate_path_for, read_candidate_sidecar
from constants import STAGING_DIR_NAME
from external.comfy_client import ComfyError

WORKFLOW = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "example.png"}},
    "3": {"class_type": "SaveImage", "inputs": {"filename_prefix": "out", "images": ["1", 0]}},
}

WORKFLOW_WITH_PROMPT = {
    **WORKFLOW,
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "as saved", "clip": ["4", 0]},
        "_meta": {"title": "DataForge Prompt"},
    },
}


def png_bytes(size: tuple[int, int], colour: str = "blue") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, format="PNG")
    return buffer.getvalue()


class Workspace:
    """A folder of images plus a workflow preset the job can find."""

    def __init__(self, names: tuple[str, ...] = ("a.png", "b.png")) -> None:
        self._temp = tempfile.TemporaryDirectory()
        root = Path(self._temp.name)
        self.folder = root / "dataset"
        self.folder.mkdir()
        self.presets = root / "presets"
        self.presets.mkdir()
        (self.presets / "upscale.json").write_text(json.dumps(WORKFLOW), encoding="utf-8")
        (self.presets / "prompted.json").write_text(
            json.dumps(WORKFLOW_WITH_PROMPT), encoding="utf-8"
        )

        for name in names:
            Image.new("RGB", (16, 16), "red").save(self.folder / name)

        self._previous = os.environ.get("COMFY_WORKFLOWS_DIR")
        os.environ["COMFY_WORKFLOWS_DIR"] = str(self.presets)

    def __enter__(self) -> "Workspace":
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._previous is None:
            os.environ.pop("COMFY_WORKFLOWS_DIR", None)
        else:
            os.environ["COMFY_WORKFLOWS_DIR"] = self._previous
        self._temp.cleanup()


def comfy_handler(*, fail_on: set[str] | None = None):
    """A ComfyUI that accepts every prompt and returns one image per run."""
    failing = fail_on or set()
    state = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path

        if path == "/upload/image":
            return httpx.Response(200, json={"name": "in.png", "subfolder": "dataforge"})

        if path == "/prompt":
            state["count"] += 1
            return httpx.Response(200, json={"prompt_id": f"p-{state['count']}", "node_errors": {}})

        if path.startswith("/history/"):
            prompt_id = path.rsplit("/", 1)[-1]
            if prompt_id in failing:
                return httpx.Response(
                    200,
                    json={
                        prompt_id: {
                            "status": {
                                "status_str": "error",
                                "messages": [
                                    [
                                        "execution_error",
                                        {"node_type": "SaveImage", "exception_message": "boom"},
                                    ]
                                ],
                            }
                        }
                    },
                )
            return httpx.Response(
                200,
                json={
                    prompt_id: {
                        "status": {"completed": True},
                        "outputs": {
                            "3": {
                                "images": [
                                    {"filename": "out.png", "subfolder": "", "type": "output"}
                                ]
                            }
                        },
                    }
                },
            )

        if path == "/view":
            return httpx.Response(200, content=png_bytes((32, 32)))

        return httpx.Response(200, json={})

    return handler


def run_with(handler, folder: Path, *, preset: str = "upscale", **kwargs: object) -> dict:
    """Run the job against a mocked ComfyUI."""

    # Bound before the patch: `httpx.Client` is what gets replaced, so looking it up
    # inside the factory would call the factory again.
    real_client = httpx.Client

    def make_client(*_args: object, **_kwargs: object) -> httpx.Client:
        return real_client(transport=httpx.MockTransport(handler))

    with patch("automation.comfy_process.httpx.Client", make_client):
        return run_comfy_process_job(folder, preset=preset, **kwargs)  # type: ignore[arg-type]


class ValidateTests(unittest.TestCase):
    def test_a_missing_folder_is_refused(self) -> None:
        with Workspace() as workspace, self.assertRaises(ValueError) as caught:
            validate_comfy_process_folder(workspace.folder / "nope", preset="upscale")

        self.assertIn("Folder not found", str(caught.exception))

    def test_the_staging_folder_itself_is_refused(self) -> None:
        # Otherwise a second run would stage candidates of candidates.
        with Workspace() as workspace:
            staging = workspace.folder / STAGING_DIR_NAME
            staging.mkdir()
            Image.new("RGB", (16, 16), "red").save(staging / "a.png")

            with self.assertRaises(ValueError) as caught:
                validate_comfy_process_folder(staging, preset="upscale")

            self.assertIn("staging folder", str(caught.exception))

    def test_an_unknown_preset_surfaces_as_a_value_error(self) -> None:
        # ValueError is what the route turns into a 400; a ComfyWorkflowError escaping
        # here would be a 500 and lose the message that names the fix.
        with Workspace() as workspace, self.assertRaises(ValueError):
            validate_comfy_process_folder(workspace.folder, preset="nope")

    def test_an_empty_preset_name_is_refused(self) -> None:
        with Workspace() as workspace, self.assertRaises(ValueError):
            validate_comfy_process_folder(workspace.folder, preset="")

    def test_a_folder_with_no_images_is_refused(self) -> None:
        with Workspace(names=()) as workspace, self.assertRaises(ValueError) as caught:
            validate_comfy_process_folder(workspace.folder, preset="upscale")

        self.assertIn("No images", str(caught.exception))

    def test_a_prompt_is_refused_when_the_preset_has_nowhere_to_put_it(self) -> None:
        # build_comfy_prompt has no node to write to and would drop the text in silence,
        # which looks exactly like a prompt the model ignored.
        with Workspace() as workspace, self.assertRaises(ValueError) as caught:
            validate_comfy_process_folder(
                workspace.folder, preset="upscale", prompt_text="sharp photograph"
            )

        self.assertIn("DataForge Prompt", str(caught.exception))

    def test_a_preset_with_a_prompt_node_takes_one(self) -> None:
        with Workspace() as workspace:
            validate_comfy_process_folder(
                workspace.folder, preset="prompted", prompt_text="sharp photograph"
            )

    def test_a_blank_prompt_is_no_prompt_at_all(self) -> None:
        """Whitespace is the empty box, so it must not refuse a preset without the node."""
        with Workspace() as workspace:
            validate_comfy_process_folder(workspace.folder, preset="upscale", prompt_text="   ")

    def test_staging_existing_as_a_file_is_refused(self) -> None:
        with Workspace() as workspace:
            (workspace.folder / STAGING_DIR_NAME).write_text("not a folder", encoding="utf-8")

            with self.assertRaises(ValueError) as caught:
                validate_comfy_process_folder(workspace.folder, preset="upscale")

            self.assertIn("cannot be written", str(caught.exception))


class RunJobTests(unittest.TestCase):
    def test_the_prompt_reaches_the_graph_and_the_record(self) -> None:
        submitted: list[dict] = []

        def capturing(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/prompt":
                submitted.append(json.loads(request.content)["prompt"])
            return comfy_handler()(request)

        with Workspace(names=("a.png",)) as workspace:
            run_with(
                capturing,
                workspace.folder,
                preset="prompted",
                prompt_text="  sharp studio photograph  ",
            )

            # Trimmed on the way in: the padding is typing, not part of the prompt.
            self.assertEqual(submitted[0]["7"]["inputs"]["text"], "sharp studio photograph")

            stored = read_candidate_sidecar(candidate_path_for(workspace.folder / "a.png"))
            assert stored is not None
            self.assertEqual(stored.prompt_text, "sharp studio photograph")

    def test_an_empty_prompt_leaves_the_graphs_own_text(self) -> None:
        """Empty means "run it as saved", which is not the same as writing "" into it."""
        submitted: list[dict] = []

        def capturing(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/prompt":
                submitted.append(json.loads(request.content)["prompt"])
            return comfy_handler()(request)

        with Workspace(names=("a.png",)) as workspace:
            run_with(capturing, workspace.folder, preset="prompted")

            self.assertEqual(submitted[0]["7"]["inputs"]["text"], "as saved")

            stored = read_candidate_sidecar(candidate_path_for(workspace.folder / "a.png"))
            assert stored is not None
            self.assertIsNone(stored.prompt_text)

    def test_every_image_is_staged_and_the_originals_are_untouched(self) -> None:
        with Workspace() as workspace:
            result = run_with(comfy_handler(), workspace.folder)

            self.assertEqual(result["stats"]["success"], 2)
            for name in ("a.png", "b.png"):
                candidate = workspace.folder / STAGING_DIR_NAME / name
                self.assertTrue(candidate.is_file())
                with Image.open(candidate) as staged:
                    self.assertEqual(staged.size, (32, 32))
                # The dataset file still has its own pixels.
                with Image.open(workspace.folder / name) as original:
                    self.assertEqual(original.size, (16, 16))

    def test_a_candidate_records_what_produced_it(self) -> None:
        with Workspace(names=("a.png",)) as workspace:
            run_with(comfy_handler(), workspace.folder, seed=4321)

            stored = read_candidate_sidecar(candidate_path_for(workspace.folder / "a.png"))
            self.assertIsNotNone(stored)
            assert stored is not None
            self.assertEqual(stored.preset, "upscale")
            self.assertEqual(stored.seed, 4321)
            self.assertEqual(stored.source_name, "a.png")
            self.assertEqual(stored.prompt_id, "p-1")

    def test_a_candidate_records_how_far_it_moved_from_the_source(self) -> None:
        """Scored during the run, so the review queue never has to open two files.

        The fixture images are flat, which hashes to zero on both sides - what is under
        test is that a number was written at all, not what it was.
        """
        with Workspace(names=("a.png",)) as workspace:
            run_with(comfy_handler(), workspace.folder)

            stored = read_candidate_sidecar(candidate_path_for(workspace.folder / "a.png"))
            assert stored is not None
            self.assertIsNotNone(stored.difference_percent)

    def test_the_candidate_keeps_the_sources_format(self) -> None:
        # ComfyUI returns PNG; a JPEG source must come back JPEG or its sidecars would
        # be orphaned the moment the candidate was accepted.
        with Workspace(names=()) as workspace:
            Image.new("RGB", (16, 16), "red").save(workspace.folder / "photo.jpg")

            run_with(comfy_handler(), workspace.folder)

            candidate = workspace.folder / STAGING_DIR_NAME / "photo.jpg"
            self.assertTrue(candidate.is_file())
            with Image.open(candidate) as staged:
                self.assertEqual(staged.format, "JPEG")

    def test_a_failed_prompt_is_counted_without_stopping_the_run(self) -> None:
        with Workspace() as workspace:
            result = run_with(comfy_handler(fail_on={"p-1"}), workspace.folder)

            self.assertEqual(result["stats"]["comfy_error"], 1)
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["processed"], 2)
            self.assertIn("boom", result["results"][0]["message"])

    def test_an_existing_candidate_is_skipped_by_default(self) -> None:
        with Workspace(names=("a.png",)) as workspace:
            run_with(comfy_handler(), workspace.folder)
            result = run_with(comfy_handler(), workspace.folder)

            self.assertEqual(result["stats"]["skipped"], 1)

    def test_a_run_that_skips_everything_still_finishes_at_the_total(self) -> None:
        """A skipped file was handled. Counting it as unprocessed stalls the bar."""
        with Workspace(names=("a.png", "b.png")) as workspace:
            run_with(comfy_handler(), workspace.folder)
            result = run_with(comfy_handler(), workspace.folder)

            self.assertEqual(result["stats"]["skipped"], 2)
            self.assertEqual(result["processed"], result["total"])

    def test_a_partly_skipped_run_finishes_at_the_total(self) -> None:
        # The reported shape: most files process, a couple already have candidates, and
        # the run used to stop short of 100% by exactly that couple.
        with Workspace(names=("a.png",)) as workspace:
            run_with(comfy_handler(), workspace.folder)
            Image.new("RGB", (16, 16), "red").save(workspace.folder / "b.png")

            result = run_with(comfy_handler(), workspace.folder)

            self.assertEqual(result["stats"]["skipped"], 1)
            self.assertEqual(result["stats"]["success"], 1)
            self.assertEqual(result["processed"], result["total"])

    def test_overwriting_reprocesses_an_existing_candidate(self) -> None:
        with Workspace(names=("a.png",)) as workspace:
            run_with(comfy_handler(), workspace.folder)
            result = run_with(comfy_handler(), workspace.folder, overwrite_candidates=True)

            self.assertEqual(result["stats"]["success"], 1)

    def test_a_result_carries_the_candidate_for_a_preview(self) -> None:
        with Workspace(names=("a.png",)) as workspace:
            result = run_with(comfy_handler(), workspace.folder)

            self.assertEqual(
                result["results"][0]["preview"],
                str(candidate_path_for(workspace.folder / "a.png")),
            )

    def test_an_unreachable_comfy_reports_itself_per_file(self) -> None:
        def refusing(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        with Workspace() as workspace:
            result = run_with(refusing, workspace.folder)

            self.assertEqual(result["stats"]["comfy_error"], 2)
            self.assertIn("not reachable", result["results"][0]["message"])

    def test_cancelling_stops_the_run_and_credits_the_rest(self) -> None:
        with Workspace(names=("a.png", "b.png", "c.png")) as workspace:
            result = run_with(comfy_handler(), workspace.folder, should_cancel=lambda: True)

            # Cancelled between files, before anything was sent: every file is credited
            # as cancelled and none as done.
            self.assertEqual(result["stats"]["cancelled"], 3)
            self.assertEqual(result["stats"].get("success", 0), 0)
            self.assertEqual(result["processed"], 0)


class AwaitOutputTests(unittest.TestCase):
    def test_a_cancel_mid_image_raises_rather_than_waiting_it_out(self) -> None:
        # run_media_job only checks between files, so at a minute an image a cancel
        # would otherwise look dead for the length of whatever is in flight.
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/queue":
                return httpx.Response(200, json={"queue_running": [], "queue_pending": []})
            return httpx.Response(200, json={})

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ComfyProcessCancelled):
                _await_output(client, "p-1", should_cancel=lambda: True)

    def test_a_finished_run_returns_its_last_output(self) -> None:
        entry = {
            "status": {"completed": True},
            "outputs": {
                "2": {"images": [{"filename": "preview.png", "subfolder": "", "type": "temp"}]},
                "3": {"images": [{"filename": "final.png", "subfolder": "", "type": "output"}]},
            },
        }

        with httpx.Client(
            transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"p-1": entry}))
        ) as client:
            ref = _await_output(client, "p-1", should_cancel=None)

        # Last wins: a graph that previews an intermediate step and saves the final one
        # lists them in execution order.
        self.assertEqual(ref["filename"], "final.png")

    def test_a_run_that_produced_nothing_says_so(self) -> None:
        entry = {"status": {"completed": True}, "outputs": {"3": {"images": []}}}

        with httpx.Client(
            transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"p-1": entry}))
        ) as client:
            with self.assertRaises(ComfyError):
                _await_output(client, "p-1", should_cancel=None)


class RequestStopTests(unittest.TestCase):
    """`/interrupt` has no prompt argument, so the queue decides whether it is ours."""

    def _client(self, payload: dict, calls: list[str]) -> httpx.Client:
        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request.url.path)
            if request.url.path == "/queue" and request.method == "GET":
                return httpx.Response(200, json=payload)
            return httpx.Response(200, json={})

        return httpx.Client(transport=httpx.MockTransport(handler))

    def test_our_running_prompt_is_interrupted(self) -> None:
        calls: list[str] = []
        payload = {"queue_running": [[0, "p-1", {}]], "queue_pending": []}

        with self._client(payload, calls) as client:
            _request_stop(client, "p-1")

        self.assertIn("/interrupt", calls)

    def test_someone_elses_prompt_is_never_interrupted(self) -> None:
        # The sharpest trap in the feature: interrupting here would kill another job's
        # image, or the user's own work in the ComfyUI tab.
        calls: list[str] = []
        payload = {"queue_running": [[0, "someone-else", {}]], "queue_pending": []}

        with self._client(payload, calls) as client:
            _request_stop(client, "p-1")

        self.assertNotIn("/interrupt", calls)

    def test_a_still_pending_prompt_is_dropped_from_the_queue(self) -> None:
        calls: list[str] = []
        payload = {"queue_running": [[0, "someone-else", {}]], "queue_pending": [[1, "p-1", {}]]}

        with self._client(payload, calls) as client:
            _request_stop(client, "p-1")

        self.assertNotIn("/interrupt", calls)
        # The POST to /queue is the delete.
        self.assertEqual(calls.count("/queue"), 2)

    def test_an_unreachable_comfy_stops_quietly(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            _request_stop(client, "p-1")


if __name__ == "__main__":
    unittest.main()
