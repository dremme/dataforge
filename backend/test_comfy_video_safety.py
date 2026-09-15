import json
import tempfile
import unittest
from pathlib import Path

import httpx

from automation.comfy_process import _await_output, _measure_video_candidate
from automation.test_comfy_process import VideoWorkspace, run_with, video_handler
from comfy_candidates import accept_candidate, read_candidate_sidecar
from external.comfy_client import ComfyError
from external.comfy_workflows import ComfyWorkflowError, parse_comfy_workflow
from testing_fixtures import playable_video_bytes, write_gif


class VideoSafetyTests(unittest.TestCase):
    def test_a_sibling_candidate_is_not_overwritten(self):
        with VideoWorkspace(names=("clip.mov", "clip.mp4")) as workspace:
            staged = workspace.folder / "staging"
            staged.mkdir()
            candidate = staged / "clip.mp4"
            candidate.write_bytes(playable_video_bytes())
            before = candidate.read_bytes()
            result = run_with(
                video_handler(content=playable_video_bytes(audio=True)),
                workspace.folder,
                preset="vfi",
                selected_paths=[workspace.folder / "clip.mov"],
            )
            self.assertEqual(candidate.read_bytes(), before)
            self.assertEqual(result["stats"].get("success", 0), 0)

    def test_invalid_output_preserves_the_previous_candidate(self):
        with VideoWorkspace() as workspace:
            staged = workspace.folder / "staging"
            staged.mkdir()
            candidate = staged / "clip.mp4"
            candidate.write_bytes(playable_video_bytes())
            before = candidate.read_bytes()
            result = run_with(
                video_handler(content=b"invalid video"),
                workspace.folder,
                preset="vfi",
                overwrite_candidates=True,
            )
            self.assertEqual(result["stats"].get("success", 0), 0)
            self.assertEqual(candidate.read_bytes(), before)
            self.assertFalse(list(staged.glob("*.comfy-tmp")))

    def test_accepting_invalid_video_preserves_the_source(self):
        with VideoWorkspace() as workspace:
            source = workspace.folder / "clip.mp4"
            source.write_bytes(playable_video_bytes())
            staged = workspace.folder / "staging"
            staged.mkdir()
            (staged / "clip.mp4").write_bytes(b"invalid video")
            with self.assertRaises(ValueError):
                accept_candidate(source)
            self.assertEqual(source.read_bytes(), playable_video_bytes())

    def test_missing_selected_output_does_not_select_a_preview(self):
        entry = {
            "status": {"completed": True},
            "outputs": {"11": {"gifs": []}, "9": {"images": [{"filename": "preview.png"}]}},
        }
        with httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"p": entry}))
        ) as client:
            with self.assertRaises(ComfyError):
                _await_output(client, "p", output_node="11", timeout=30, should_cancel=None)

    def test_audio_loss_is_detected_for_mkv_and_gif(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = root / "source.mkv"
            source.write_bytes(playable_video_bytes(suffix=".mkv", audio=True))
            output = root / "silent.mp4"
            output.write_bytes(playable_video_bytes())
            self.assertTrue(_measure_video_candidate(source, output).dropped_audio)
            gif = write_gif(root)
            self.assertTrue(_measure_video_candidate(source, gif).dropped_audio)

    def test_real_encoded_video_is_staged_and_measured(self):
        with VideoWorkspace() as workspace:
            source = workspace.folder / "clip.mp4"
            source.write_bytes(playable_video_bytes(audio=True))
            result = run_with(
                video_handler(content=playable_video_bytes()), workspace.folder, preset="vfi"
            )
            self.assertEqual(result["stats"]["success"], 1)
            state = read_candidate_sidecar(workspace.folder / "staging" / "clip.mp4")
            assert state is not None
            self.assertEqual(state.frame_count, 10)
            assert state.duration_seconds is not None
            self.assertAlmostEqual(state.duration_seconds, 1)
            self.assertTrue(state.dropped_audio)


class WorkflowRefusalTests(unittest.TestCase):
    """Refusals that have to fire at parse time: both would otherwise process the wrong bytes."""

    def graph(self, loader: str = "VHS_LoadVideo", key: str = "video") -> dict:
        return {
            "1": {
                "class_type": loader,
                "inputs": {key: "clip.mp4"},
                "_meta": {"title": "DataForge Input"},
            },
            "2": {
                "class_type": "VHS_VideoCombine",
                "inputs": {"images": ["1", 0], "filename_prefix": "out"},
            },
        }

    def test_filesystem_loaders_are_rejected_before_upload(self) -> None:
        # An uploaded name is relative to ComfyUI's input dir; a path loader would read elsewhere.
        for loader in ("VHS_LoadVideoPath", "VHS_LoadImagePath"):
            with self.subTest(loader=loader):
                with self.assertRaisesRegex(ComfyWorkflowError, "upload"):
                    parse_comfy_workflow(json.dumps(self.graph(loader)), source="path")

    def test_batch_managers_are_rejected_before_upload(self) -> None:
        # Its continuations are separate prompts, so one submit would stage a truncated clip.
        graph = self.graph()
        graph["3"] = {"class_type": "VHS_BatchManager", "inputs": {"frames_per_batch": 16}}

        with self.assertRaisesRegex(ComfyWorkflowError, "batch"):
            parse_comfy_workflow(json.dumps(graph), source="batched")
