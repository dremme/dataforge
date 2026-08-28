from __future__ import annotations

import json
import unittest

from comfy_prompts import extract_workflow_prompts
from testing_fixtures import TempMediaFolder, write_media

LOADER = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "landscape.safetensors"}}


def _sampler(positive: str, negative: str, seed: int = 42) -> dict:
    return {
        "class_type": "KSampler",
        "inputs": {
            "positive": [positive, 0],
            "negative": [negative, 0],
            "seed": seed,
            "steps": 20,
            "sampler_name": "euler",
        },
    }


def _save(latent: str, prefix: str) -> dict:
    return {"class_type": "SaveImage", "inputs": {"images": [latent, 0], "filename_prefix": prefix}}


def _encode(text: object) -> dict:
    return {"class_type": "CLIPTextEncode", "inputs": {"text": text, "clip": ["1", 1]}}


def _write(root, name: str, graph: dict, workflow: dict | None = None):
    chunks = {"prompt": json.dumps(graph)}
    if workflow is not None:
        chunks["workflow"] = json.dumps(workflow)
    return write_media(root, name, text_chunks=chunks)


class PromptExtractionTests(unittest.TestCase):
    def test_reads_prompt_through_a_string_node_inside_a_subgraph(self) -> None:
        graph = {
            "1": LOADER,
            "9:2": {
                "class_type": "PrimitiveStringMultiline",
                "inputs": {"value": "a mountain lake at sunrise"},
            },
            "9:3": _encode(["9:2", 0]),
            "9:4": _encode("blurry, low quality"),
            "9:5": _sampler("9:3", "9:4"),
            "6": _save("9:5", "scenery"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scenery_00001_.png", graph))

        self.assertEqual(len(result.branches), 1)
        texts = {prompt.role: prompt.text for prompt in result.branches[0].prompts}
        self.assertEqual(texts["positive"], "a mountain lake at sunrise")
        self.assertEqual(texts["negative"], "blurry, low quality")

    def test_polarity_comes_from_the_sampler_slot_not_the_encoder_input(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a red bicycle"),
            "3": _encode("watermark, text"),
            "4": _sampler("2", "3"),
            "5": _save("4", "bikes"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "bikes_00007_.png", graph))

        prompts = result.branches[0].prompts
        self.assertEqual([prompt.role for prompt in prompts], ["positive", "negative"])
        self.assertEqual(prompts[1].text, "watermark, text")
        self.assertEqual(prompts[1].node_id, "3")

    def test_each_output_reports_only_the_prompts_feeding_it(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a forest path in fog"),
            "3": _encode("a harbour at night"),
            "4": _encode("blurry"),
            "5": _sampler("2", "4"),
            "6": _sampler("3", "4"),
            "7": _save("5", "forest"),
            "8": _save("6", "harbour"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00002_.png", graph))

        branches = {branch.node_id: branch for branch in result.branches}
        self.assertEqual(
            [prompt.text for prompt in branches["7"].prompts],
            ["a forest path in fog", "blurry"],
        )
        self.assertEqual(
            [prompt.text for prompt in branches["8"].prompts],
            ["a harbour at night", "blurry"],
        )

    def test_the_last_stage_to_touch_the_pixels_is_listed_first(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a mountain lake at sunrise"),
            "3": _sampler("2", "2"),
            "4": {
                "class_type": "ImageToVideo",
                "inputs": {"prompt": "the camera pans across the water", "start_image": ["3", 0]},
            },
            "5": _save("4", "scenery"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scenery_00001_.png", graph))

        self.assertEqual(
            [prompt.text for prompt in result.branches[0].prompts],
            ["the camera pans across the water", "a mountain lake at sunrise"],
        )

    def test_filename_picks_the_output_that_wrote_the_file(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a forest path in fog"),
            "3": _encode("a harbour at night"),
            "4": _encode("blurry"),
            "5": _sampler("2", "4"),
            "6": _sampler("3", "4"),
            "7": _save("5", "renders/forest"),
            "8": _save("6", "renders/harbour"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00002_.png", graph))

        self.assertEqual(result.matched_node_id, "8")
        self.assertTrue(result.branches[0].matches_filename)
        self.assertEqual(result.branches[0].node_id, "8")

    def test_outputs_sharing_a_prefix_stay_unresolved(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a forest path in fog"),
            "3": _encode("a harbour at night"),
            "4": _encode("blurry"),
            "5": _sampler("2", "4"),
            "6": _sampler("3", "4"),
            "7": _save("5", "renders/shot"),
            "8": _save("6", "renders/shot"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "shot_00002_.png", graph))

        self.assertIsNone(result.matched_node_id)
        self.assertEqual([branch.matches_filename for branch in result.branches], [True, True])

    def test_branch_is_labelled_by_the_subgraph_that_produced_it(self) -> None:
        graph = {
            "1": LOADER,
            "9:2": _encode("a mountain lake at sunrise"),
            "9:3": _sampler("9:2", "9:2"),
            "4": _save("9:3", "scenery"),
        }
        workflow = {
            "nodes": [{"id": 9, "type": "abc-123"}],
            "definitions": {"subgraphs": [{"id": "abc-123", "name": "Text to Image"}]},
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scenery_00001_.png", graph, workflow))

        self.assertTrue(result.branches[0].label.startswith("Text to Image"))

    def test_reports_model_seed_and_loras_for_the_branch(self) -> None:
        graph = {
            "1": LOADER,
            "2": {
                "class_type": "LoraLoader",
                "inputs": {"lora_name": "film_grain.safetensors", "model": ["1", 0]},
            },
            "3": _encode("a red bicycle"),
            "4": _sampler("3", "3", seed=1234),
            "5": {
                "class_type": "SaveImage",
                "inputs": {"images": ["4", 0], "latent": ["2", 0], "filename_prefix": "bikes"},
            },
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "bikes_00001_.png", graph))

        branch = result.branches[0]
        self.assertIn(("Seed", "1234"), [(p.label, p.value) for p in branch.parameters])
        self.assertIn(
            ("Checkpoint", "landscape.safetensors"), [(p.label, p.value) for p in branch.parameters]
        )
        self.assertEqual(branch.loras, ["film_grain.safetensors"])

    def test_media_without_metadata_reports_no_workflow(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "plain.png")
            result = extract_workflow_prompts(media)

        self.assertFalse(result.has_workflow)
        self.assertEqual(result.branches, [])


if __name__ == "__main__":
    unittest.main()
