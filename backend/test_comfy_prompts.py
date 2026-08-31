from __future__ import annotations

import json
import unittest

from comfy_prompts import extract_workflow_prompts
from testing_fixtures import TempMediaFolder, write_media, write_mp4_video

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


def _write_muxed(
    root, name: str, graph: dict, workflow: dict | None = None, *, key: str = "comment", **kwargs
):
    """The shape ComfyUI's video muxer writes: one payload under `comment`, a level down."""
    payload: dict[str, object] = {"prompt": json.dumps(graph)}
    if workflow is not None:
        # Not a string like `prompt` is; the muxer embeds this one as an object.
        payload["workflow"] = workflow
    return write_mp4_video(root, name, metadata={key: json.dumps(payload)}, **kwargs)


class NestedPayloadTests(unittest.TestCase):
    """A video carries no top-level `prompt` key; the whole payload sits inside `comment`."""

    def graph(self) -> dict:
        return {
            "1": LOADER,
            "2": _encode("a harbour at dawn"),
            "3": _encode("blurry"),
            "4": _sampler("2", "3"),
            "5": {
                "class_type": "VHS_VideoCombine",
                "inputs": {"images": ["4", 0], "filename_prefix": "harbour"},
            },
        }

    def test_reads_a_payload_nested_under_a_comment(self) -> None:
        with TempMediaFolder() as root:
            media = _write_muxed(root, "harbour_00001.mp4", self.graph())

            result = extract_workflow_prompts(media)

        self.assertTrue(result.has_workflow)
        self.assertEqual(len(result.branches), 1)
        texts = {prompt.role: prompt.text for prompt in result.branches[0].prompts}
        self.assertEqual(texts["positive"], "a harbour at dawn")

    def test_the_nested_workflow_still_labels_the_branch(self) -> None:
        workflow = {
            "definitions": {"subgraphs": [{"id": "sub-1", "name": "Harbour at dawn"}]},
            "nodes": [{"id": 9, "type": "sub-1"}],
        }
        graph = self.graph()
        graph["9:5"] = graph.pop("5")
        graph["9:5"]["inputs"]["images"] = ["4", 0]

        with TempMediaFolder() as root:
            media = _write_muxed(root, "harbour_00001.mp4", graph, workflow)

            result = extract_workflow_prompts(media)

        self.assertEqual(len(result.branches), 1)
        self.assertEqual(result.branches[0].label, "Harbour at dawn")

    def test_a_top_level_prompt_still_wins_over_a_nested_one(self) -> None:
        """A PNG carries both the chunk and, sometimes, a comment; the chunk is the real one."""
        with TempMediaFolder() as root:
            media = write_media(
                root,
                "harbour_00001.png",
                text_chunks={
                    "prompt": json.dumps(self.graph()),
                    "comment": json.dumps({"prompt": json.dumps({"1": LOADER})}),
                },
            )

            result = extract_workflow_prompts(media)

        self.assertEqual(len(result.branches), 1)
        self.assertTrue(result.branches[0].prompts)

    def test_a_comment_that_carries_no_workflow_is_left_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(
                root, "clip_00001.mp4", metadata={"comment": "rendered on the farm"}
            )

            result = extract_workflow_prompts(media)

        self.assertFalse(result.has_workflow)
        self.assertEqual(result.branches, [])

    def test_it_reads_the_same_payload_from_a_classic_metadata_box(self) -> None:
        with TempMediaFolder() as root:
            # Classic boxes key on four characters; ffmpeg writes the comment as `©cmt`.
            media = _write_muxed(
                root, "harbour_00001.mp4", self.graph(), metadata_format="classic", key="©cmt"
            )

            result = extract_workflow_prompts(media)

        self.assertTrue(result.has_workflow)
        self.assertEqual(len(result.branches), 1)


class OutputNodeTests(unittest.TestCase):
    """Only a node that writes a file is a branch; the graph is full of dead ends that do not."""

    def test_a_dangling_decode_is_not_an_output(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a harbour at dawn"),
            "3": _encode("blurry"),
            "4": _sampler("2", "3"),
            "5": _save("4", "harbour"),
            # Nothing consumes it and it writes nothing, but it does read a link.
            "6": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001_.png", graph))

        self.assertEqual([branch.class_type for branch in result.branches], ["SaveImage"])

    def test_every_dead_end_class_seen_in_the_wild_is_left_out(self) -> None:
        graph = {"1": LOADER, "2": _encode("a harbour"), "3": _encode(""), "4": _sampler("2", "3")}
        for index, class_type in enumerate(
            (
                "VAEDecode",
                "VHS_MergeImages",
                "VHS_SelectImages",
                "ReverseImageBatch",
                "FaceDetailer",
            )
        ):
            graph[f"1{index}"] = {"class_type": class_type, "inputs": {"samples": ["4", 0]}}
        graph["9"] = _save("4", "harbour")

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001_.png", graph))

        self.assertEqual([branch.class_type for branch in result.branches], ["SaveImage"])

    def test_a_preview_is_still_a_branch_even_though_it_saves_nothing(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a harbour at dawn"),
            "3": _encode("blurry"),
            "4": _sampler("2", "3"),
            "5": {"class_type": "PreviewImage", "inputs": {"images": ["4", 0]}},
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001_.png", graph))

        self.assertEqual(len(result.branches), 1)
        self.assertTrue(result.branches[0].is_preview)

    def test_a_video_muxer_is_an_output_wherever_it_sits(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a harbour at dawn"),
            "3": _encode("blurry"),
            "4": _sampler("2", "3"),
            "5": {
                "class_type": "VHS_VideoCombine",
                "inputs": {"images": ["4", 0], "filename_prefix": "harbour"},
            },
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001_.png", graph))

        self.assertEqual([branch.class_type for branch in result.branches], ["VHS_VideoCombine"])


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
