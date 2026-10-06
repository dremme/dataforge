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

    def test_a_preview_override_feeding_the_sampler_is_not_an_output(self) -> None:
        sampler = _sampler("2", "3")
        sampler["inputs"]["model"] = ["6", 0]
        graph = {
            "1": LOADER,
            "2": _encode("a harbour at dawn"),
            "3": _encode("blurry"),
            "4": sampler,
            "5": _save("4", "harbour"),
            "6": {
                "class_type": "ModelPreviewOverrideKJ",
                "inputs": {"model": ["1", 0], "preview_fps": 8},
            },
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001_.png", graph))

        self.assertEqual([branch.class_type for branch in result.branches], ["SaveImage"])

    def test_a_save_or_preview_node_that_takes_no_media_is_not_an_output(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a harbour at dawn"),
            "3": _encode("blurry"),
            "4": _sampler("2", "3"),
            "5": _save("4", "harbour"),
            "6": {
                "class_type": "Save Text File",
                "inputs": {"text": ["7", 0], "path": "./output", "filename_prefix": "harbour"},
            },
            "7": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "a harbour"}},
            "8": {"class_type": "PM LoRA Save", "inputs": {"lora": ["1", 0], "file_name": "x"}},
            "9": {"class_type": "PreviewAny", "inputs": {"source": ["7", 0]}},
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001_.png", graph))

        self.assertEqual([branch.class_type for branch in result.branches], ["SaveImage"])

    def test_a_passthrough_preview_is_still_a_branch(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a harbour at dawn"),
            "3": _encode("blurry"),
            "4": _sampler("2", "3"),
            # The editor can give PreviewImage an output that hands its images to the next stage.
            "5": {"class_type": "PreviewImage", "inputs": {"images": ["4", 0]}},
            "6": {"class_type": "ImageScale", "inputs": {"image": ["5", 0]}},
            "7": _save("6", "harbour"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001_.png", graph))

        self.assertEqual(
            sorted(branch.class_type for branch in result.branches), ["PreviewImage", "SaveImage"]
        )

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

    def test_an_upstream_generation_stage_is_not_part_of_the_output(self) -> None:
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
            ["the camera pans across the water"],
        )
        self.assertEqual(result.branches[0].parameters, [])
        self.assertEqual(result.orphan_prompts, [])

    def test_a_sampled_video_stops_at_the_image_stage_that_made_its_first_frame(self) -> None:
        graph = {
            "1": LOADER,
            "2": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "a portrait"}},
            "3": _encode(["2", 0]),
            "4": _sampler("3", "3", seed=7),
            "6": {"class_type": "VAELoader", "inputs": {"vae_name": "image.safetensors"}},
            "7": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["6", 0]}},
            "8": {
                "class_type": "VideoFromImage",
                "inputs": {"prompt": "she turns to the window", "first_frame": ["7", 0]},
            },
            "9": {
                "class_type": "SamplerCustomAdvanced",
                "inputs": {"guider": ["8", 0], "latent_image": ["8", 1], "noise_seed": 3},
            },
            "10": {"class_type": "VAELoader", "inputs": {"vae_name": "video.safetensors"}},
            "11": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["10", 0]}},
            "12": {
                "class_type": "VHS_VideoCombine",
                "inputs": {"images": ["11", 0], "filename_prefix": "clip"},
            },
            "13": {"class_type": "PreviewImage", "inputs": {"images": ["7", 0]}},
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write_muxed(root, "clip_00001.mp4", graph))

        branches = {branch.node_id: branch for branch in result.branches}
        video = branches["12"]
        self.assertEqual([prompt.text for prompt in video.prompts], ["she turns to the window"])
        self.assertEqual(
            {(parameter.label, parameter.value) for parameter in video.parameters},
            {("Seed", "3"), ("VAE", "video.safetensors")},
        )
        self.assertEqual([prompt.text for prompt in branches["13"].prompts], ["a portrait"])

    def test_a_detailer_refines_its_stage_rather_than_starting_a_new_one(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a dancer on a stage"),
            "3": _encode("blurry"),
            "4": _sampler("2", "3"),
            "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
            "6": _encode("a detailed face"),
            "7": {
                "class_type": "FaceDetailer",
                "inputs": {"image": ["5", 0], "positive": ["6", 0], "negative": ["3", 0]},
            },
            "8": _save("7", "dancer"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "dancer_00001_.png", graph))

        self.assertEqual(
            [prompt.text for prompt in result.branches[0].prompts],
            ["a detailed face", "blurry", "a dancer on a stage"],
        )

    def test_a_save_node_that_writes_a_caption_is_not_a_generation_stage(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a dancer on a stage"),
            "3": _sampler("2", "2"),
            "4": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["1", 2]}},
            "5": {
                "class_type": "SaveImageKJ",
                "inputs": {"images": ["4", 0], "caption": "dancer", "filename_prefix": "dancer"},
            },
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "dancer_00001_.png", graph))

        self.assertIn("a dancer on a stage", [prompt.text for prompt in result.branches[0].prompts])

    def test_a_second_pass_keeps_the_prompt_it_shares_with_the_first(self) -> None:
        first = _sampler("2", "3", seed=1)
        second = _sampler("2", "3", seed=2)
        second["inputs"]["latent_image"] = ["5", 0]
        graph = {
            "1": LOADER,
            "2": _encode("a lighthouse in a storm"),
            "3": _encode("blurry"),
            "4": first,
            "5": {"class_type": "LatentUpscaleBy", "inputs": {"samples": ["4", 0]}},
            "6": second,
            "7": _save("6", "storm"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "storm_00001_.png", graph))

        branch = result.branches[0]
        self.assertEqual(
            [prompt.text for prompt in branch.prompts], ["a lighthouse in a storm", "blurry"]
        )
        self.assertIn(("Seed", "2"), {(p.label, p.value) for p in branch.parameters})
        self.assertNotIn(("Seed", "1"), {(p.label, p.value) for p in branch.parameters})

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


class LinkedParameterTests(unittest.TestCase):
    def test_resolves_linked_sampler_scheduler_steps_and_megapixels(self) -> None:
        graph = {
            "1": {"class_type": "PrimitiveString", "inputs": {"value": "euler"}},
            "2": {"class_type": "StringConstant", "inputs": {"string": "karras"}},
            "3": {"class_type": "INTConstant", "inputs": {"value": 24}},
            "4": {"class_type": "FloatConstant", "inputs": {"value": 1.5}},
            "5": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": ["1", 0]}},
            "6": {
                "class_type": "BasicScheduler",
                "inputs": {"scheduler": ["2", 0], "steps": ["3", 0]},
            },
            "7": {"class_type": "ImageScaleToTotalPixels", "inputs": {"megapixels": ["4", 0]}},
            "8": {
                "class_type": "SamplerCustom",
                "inputs": {"sampler": ["5", 0], "sigmas": ["6", 0], "latent_image": ["7", 0]},
            },
            "9": _save("8", "scene"),
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph))
        self.assertEqual(
            {(parameter.label, parameter.value) for parameter in result.branches[0].parameters},
            {("Sampler", "euler"), ("Scheduler", "karras"), ("Steps", "24"), ("Megapixels", "1.5")},
        )
        self.assertEqual(result.branches[0].prompts, [])

    def test_prompt_constant_upstream_of_a_measured_image_still_reads_as_a_prompt(self) -> None:
        graph = {
            "1": {"class_type": "StringConstant", "inputs": {"string": "a quiet landscape"}},
            "2": {"class_type": "ImageGenerator", "inputs": {"instruction": ["1", 0]}},
            "3": {"class_type": "GetImageSize", "inputs": {"image": ["2", 0]}},
            "4": {"class_type": "EmptyLatentImage", "inputs": {"width": ["3", 0]}},
            "9": _save("4", "scene"),
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph))
        self.assertEqual(
            [prompt.text for prompt in result.branches[0].prompts], ["a quiet landscape"]
        )

    def test_lora_strengths_resolve_through_get_set_routes_and_always_show(self) -> None:
        graph = {
            "1": {"class_type": "FloatConstant", "inputs": {"value": 0.6}},
            "2": {"class_type": "StringConstant", "inputs": {"string": "style.safetensors"}},
            "3": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {"lora_name": "turbo.safetensors", "strength_model": ["5", 0]},
            },
            "4": {
                "class_type": "LoraLoader",
                "inputs": {
                    "model": ["3", 0],
                    "lora_name": ["2", 0],
                    "strength_model": 0.8,
                    "strength_clip": 0.5,
                },
            },
            "6": {
                "class_type": "LoraLoader",
                "inputs": {"model": ["4", 0], "lora_name": "plain.safetensors"},
            },
            "10": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {
                    "model": ["6", 0],
                    "lora_name": "full.safetensors",
                    "strength_model": 1.0,
                },
            },
            "11": {
                "class_type": "Power Lora Loader (rgthree)",
                "inputs": {
                    "model": ["10", 0],
                    "lora_1": {"on": True, "lora": "stacked.safetensors", "strength": 1},
                },
            },
            "7": {"class_type": "KSampler", "inputs": {"model": ["11", 0]}},
            "9": _save("7", "scene"),
        }
        workflow = {
            "nodes": [
                {
                    "id": 8,
                    "type": "SetNode",
                    "widgets_values": ["turbo_strength"],
                    "inputs": [{"name": "FLOAT", "link": 10}],
                },
                {"id": 5, "type": "GetNode", "widgets_values": ["turbo_strength"]},
            ],
            "links": [[10, 1, 0, 8, 0, "FLOAT"]],
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph, workflow))
        self.assertEqual(
            result.branches[0].loras,
            [
                "stacked.safetensors (1.0)",
                "full.safetensors (1.0)",
                "plain.safetensors",
                "style.safetensors (0.8, clip 0.5)",
                "turbo.safetensors (0.6)",
            ],
        )

    def test_follows_named_get_set_routes_from_editor_metadata(self) -> None:
        graph = {
            "1": {"class_type": "PrimitiveInt", "inputs": {"value": 30}},
            "2": {"class_type": "KSampler", "inputs": {"steps": ["4", 0]}},
            "9": _save("2", "scene"),
        }
        workflow = {
            "nodes": [
                {
                    "id": 3,
                    "type": "SetNode",
                    "widgets_values": ["steps"],
                    "inputs": [{"name": "INT", "link": 10}],
                },
                {"id": 4, "type": "GetNode", "widgets_values": ["steps"]},
            ],
            "links": [[10, 1, 0, 3, 0, "INT"]],
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph, workflow))
        self.assertEqual(
            [(p.label, p.value) for p in result.branches[0].parameters], [("Steps", "30")]
        )

    def test_get_routes_keep_settings_in_their_own_subgraph_instance(self) -> None:
        graph = {
            "10:1": {"class_type": "PrimitiveInt", "inputs": {"value": 20}},
            "20:1": {"class_type": "PrimitiveInt", "inputs": {"value": 40}},
            "10:2": {"class_type": "KSampler", "inputs": {"steps": ["10:4", 0]}},
            "20:2": {"class_type": "KSampler", "inputs": {"steps": ["20:4", 0]}},
            "7": _save("10:2", "first"),
            "8": _save("20:2", "second"),
        }
        workflow = {
            "nodes": [{"id": 10, "type": "settings-group"}, {"id": 20, "type": "settings-group"}],
            "definitions": {
                "subgraphs": [
                    {
                        "id": "settings-group",
                        "nodes": [
                            {
                                "id": 3,
                                "type": "SetNode",
                                "widgets_values": ["steps"],
                                "inputs": [{"link": 10}],
                            },
                            {"id": 4, "type": "GetNode", "widgets_values": ["steps"]},
                        ],
                        "links": [
                            {
                                "id": 10,
                                "origin_id": 1,
                                "origin_slot": 0,
                                "target_id": 3,
                                "target_slot": 0,
                            }
                        ],
                    }
                ]
            },
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "second_00001_.png", graph, workflow))
        branches = {branch.node_id: branch for branch in result.branches}
        self.assertEqual([p.value for p in branches["7"].parameters], ["20"])
        self.assertEqual([p.value for p in branches["8"].parameters], ["40"])

    def test_cycles_missing_sources_and_computed_outputs_are_not_guessed(self) -> None:
        graph = {
            "1": {"class_type": "PrimitiveInt", "inputs": {"value": ["1", 0]}},
            "2": {
                "class_type": "MathExpression",
                "inputs": {"value": 12, "expression": "value * 2"},
            },
            "3": {"class_type": "PrimitiveInt", "inputs": {"value": 99}},
            "4": {
                "class_type": "KSampler",
                "inputs": {
                    "steps": ["1", 0],
                    "cfg": ["2", 0],
                    "seed": ["missing", 0],
                    "denoise": ["3", 1],
                },
            },
            "9": _save("4", "scene"),
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph))
        self.assertEqual(result.branches[0].parameters, [])

    def test_subgraph_getter_can_use_a_parent_setter(self) -> None:
        graph = {
            "1": {"class_type": "PrimitiveInt", "inputs": {"value": 30}},
            "10:2": {"class_type": "KSampler", "inputs": {"steps": ["10:4", 0]}},
            "9": _save("10:2", "scene"),
        }
        workflow = {
            "nodes": [
                {"id": 3, "type": "SetNode", "widgets_values": ["steps"], "inputs": [{"link": 10}]},
                {"id": 10, "type": "settings-group"},
            ],
            "links": [[10, 1, 0, 3, 0, "INT"]],
            "definitions": {
                "subgraphs": [
                    {
                        "id": "settings-group",
                        "nodes": [{"id": 4, "type": "GetNode", "widgets_values": ["steps"]}],
                    }
                ]
            },
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph, workflow))
        self.assertEqual([p.value for p in result.branches[0].parameters], ["30"])

    def test_duplicate_named_setters_remain_unresolved(self) -> None:
        graph = {
            "1": {"class_type": "PrimitiveInt", "inputs": {"value": 20}},
            "2": {"class_type": "PrimitiveInt", "inputs": {"value": 40}},
            "5": {"class_type": "KSampler", "inputs": {"steps": ["4", 0]}},
            "9": _save("5", "scene"),
        }
        workflow = {
            "nodes": [
                {"id": 3, "type": "SetNode", "widgets_values": ["steps"], "inputs": [{"link": 10}]},
                {"id": 6, "type": "SetNode", "widgets_values": ["steps"], "inputs": [{"link": 11}]},
                {"id": 4, "type": "GetNode", "widgets_values": ["steps"]},
            ],
            "links": [[10, 1, 0, 3, 0, "INT"], [11, 2, 0, 6, 0, "INT"]],
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph, workflow))
        self.assertEqual(result.branches[0].parameters, [])

    def test_invalid_optional_editor_metadata_does_not_break_api_settings(self) -> None:
        graph = {"1": {"class_type": "KSampler", "inputs": {"steps": 20}}, "9": _save("1", "scene")}
        workflow = {"nodes": None, "links": None, "definitions": {"subgraphs": None}}
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph, workflow))
        self.assertEqual([p.value for p in result.branches[0].parameters], ["20"])

    def test_rerouted_scalar_values_keep_zero_and_constant_precision(self) -> None:
        graph = {
            "1": {"class_type": "PrimitiveInt", "inputs": {"value": 0}},
            "2": {"class_type": "Reroute", "inputs": {"value": ["1", 0]}},
            "3": {"class_type": "FloatConstant", "inputs": {"value": 1.23456789}},
            "4": {"class_type": "KSampler", "inputs": {"seed": ["2", 0], "cfg": ["3", 0]}},
            "9": _save("4", "scene"),
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph))
        self.assertEqual(
            [(p.label, p.value) for p in result.branches[0].parameters],
            [("Seed", "0"), ("CFG", "1.234568")],
        )


class FilenameMatchingTests(unittest.TestCase):
    def test_prefix_matches_literal_names_and_generated_counters(self) -> None:
        cases = (
            ("scene", "scene.png", "SaveImage"),
            ("scene", "scene_00001_.png", "SaveImage"),
            ("scene", "scene_00001.mp4", "VHS_VideoCombine"),
            ("scene", "scene_00001_.mp4", "VHS_VideoCombine"),
            ("scene", "scene-00001.mp4", "VHS_VideoCombine"),
            ("scene", "scene_00001-audio.mp4", "VHS_VideoCombine"),
            ("scene_2026", "scene_2026.png", "SaveImage"),
            ("scene_2026", "scene_2026_00001_.png", "SaveImage"),
            ("renders/scene", "scene_00001_.png", "SaveImage"),
            (r"renders\scene", "scene_00001_.png", "SaveImage"),
            ("Scene", "scene_00001_.png", "SaveImage"),
            ("scene.v2", "scene.v2_00001_.png", "SaveImage"),
        )
        for prefix, name, class_type in cases:
            with self.subTest(name=name, prefix=prefix), TempMediaFolder() as root:
                node = _save("2", prefix)
                node["class_type"] = class_type
                graph = {"2": _encode("a quiet landscape"), "7": node}
                media = (
                    _write(root, name, graph)
                    if name.endswith(".png")
                    else _write_muxed(root, name, graph)
                )
                result = extract_workflow_prompts(media)
                self.assertEqual(result.matched_node_id, "7")

    def test_full_filename_video_output_is_detected_and_traced(self) -> None:
        for filename in ("scene.mp4", "renders/scene.mp4", r"renders\scene.mp4"):
            with self.subTest(filename=filename), TempMediaFolder() as root:
                graph = {
                    "2": _encode("a quiet landscape"),
                    "7": {
                        "class_type": "SwiftVRRestoreVideo",
                        "inputs": {"images": ["2", 0], "filename": filename},
                    },
                }
                result = extract_workflow_prompts(_write_muxed(root, "scene.mp4", graph))
                self.assertEqual(result.matched_node_id, "7")
                self.assertEqual(result.branches[0].filename, filename)
                self.assertIsNone(result.branches[0].filename_prefix)
                self.assertEqual(result.branches[0].prompts[0].text, "a quiet landscape")

    def test_unrelated_names_and_dynamic_names_stay_unresolved(self) -> None:
        cases = (
            ("scene", "renamed.png"),
            ("scene", "scene_extra_00001_.png"),
            ("scene.v2", "sceneXv2_00001_.png"),
            ("%date:yyyy-MM-dd%", "2026-01-01_00001_.png"),
            ("%date%", "%date%_00001_.png"),
            (["2", 0], "scene_00001_.png"),
        )
        for prefix, name in cases:
            with self.subTest(name=name, prefix=prefix), TempMediaFolder() as root:
                graph = {
                    "2": _encode("scene"),
                    "7": {
                        "class_type": "SaveImage",
                        "inputs": {"filename_prefix": prefix, "images": ["2", 0]},
                    },
                }
                result = extract_workflow_prompts(_write(root, name, graph))
                self.assertIsNone(result.matched_node_id)
                self.assertFalse(result.branches[0].matches_filename)

    def test_linked_constant_names_match_without_reading_as_prompts(self) -> None:
        for source in (
            {"class_type": "StringConstant", "inputs": {"string": "renders/scene"}},
            {"class_type": "PrimitiveString", "inputs": {"value": "renders/scene"}},
        ):
            with self.subTest(source=source["class_type"]), TempMediaFolder() as root:
                graph = {
                    "1": source,
                    "2": _encode("a quiet landscape"),
                    "7": {
                        "class_type": "SaveImage",
                        "inputs": {"images": ["2", 0], "filename_prefix": ["1", 0]},
                    },
                }
                result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph))
                self.assertEqual(result.matched_node_id, "7")
                self.assertEqual(result.branches[0].filename_prefix, "renders/scene")
                self.assertEqual(
                    [prompt.text for prompt in result.branches[0].prompts], ["a quiet landscape"]
                )

    def test_exact_full_filename_does_not_override_another_matching_prefix(self) -> None:
        graph = {
            "7": {
                "class_type": "SaveImage",
                "inputs": {"filename": "scene_00001_.png", "images": ["2", 0]},
            },
            "8": _save("2", "scene"),
        }
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001_.png", graph))
        self.assertIsNone(result.matched_node_id)
        self.assertEqual([branch.matches_filename for branch in result.branches], [True, True])

    def test_full_filename_requires_the_extension_and_has_no_counter_expansion(self) -> None:
        for name in ("scene.mov", "scene_00001.mp4"):
            with self.subTest(name=name), TempMediaFolder() as root:
                graph = {
                    "7": {
                        "class_type": "SaveVideo",
                        "inputs": {"filename": "scene.mp4", "video": ["2", 0]},
                    }
                }
                result = extract_workflow_prompts(_write_muxed(root, name, graph))
                self.assertIsNone(result.matched_node_id)

    def test_audio_suffix_is_only_a_video_helper_suite_video_convention(self) -> None:
        for class_type, name in (
            ("SaveVideo", "scene_00001-audio.mp4"),
            ("VHS_VideoCombine", "scene_00001-audio.png"),
        ):
            with self.subTest(class_type=class_type, name=name), TempMediaFolder() as root:
                media_key = "video" if class_type == "SaveVideo" else "images"
                inputs = {"filename_prefix": "scene", media_key: ["2", 0]}
                graph = {"7": {"class_type": class_type, "inputs": inputs}}
                media = (
                    _write(root, name, graph)
                    if name.endswith(".png")
                    else _write_muxed(root, name, graph)
                )
                self.assertIsNone(extract_workflow_prompts(media).matched_node_id)


def _video_stage(prompt: str, size: object, length: object, prefix: str) -> dict:
    """An image-to-video stage whose size and length are linked in, as MiniMax H3 takes them."""
    return {
        "11": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {"prompt": prompt, "width": size[0], "height": size[1], "length": length},
        },
        "12": {
            "class_type": "VHS_VideoCombine",
            "inputs": {"images": ["11", 0], "filename_prefix": prefix},
        },
    }


def _renumbered(graph: dict, offset: int) -> dict:
    def shift(value: object) -> object:
        if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
            return [str(int(value[0]) + offset), value[1]]
        return value

    return {
        str(int(node_id) + offset): {
            **node,
            "inputs": {key: shift(value) for key, value in node["inputs"].items()},
        }
        for node_id, node in graph.items()
    }


class ComputedValueTests(unittest.TestCase):
    def test_size_and_length_computed_by_core_nodes_are_shown(self) -> None:
        graph = {
            "1": {
                "class_type": "ResolutionSelector",
                "inputs": {
                    "aspect_ratio": "3:4 (Portrait Standard)",
                    "megapixels": 0.4,
                    "multiple": 32,
                },
            },
            "2": {"class_type": "PrimitiveFloat", "inputs": {"value": 3.4}},
            "3": {
                "class_type": "ComfyMathExpression",
                "inputs": {
                    "expression": "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17",
                    "values.a": ["2", 0],
                },
            },
            **_video_stage("a harbour", (["1", 0], ["1", 1]), ["3", 1], "harbour"),
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "harbour_00001.png", graph))

        shown = {parameter.label: parameter.value for parameter in result.branches[0].parameters}
        self.assertEqual((shown["Width"], shown["Height"], shown["Frames"]), ("576", "736", "90"))


class SizeTiebreakTests(unittest.TestCase):
    """Same-named outputs are told apart by the size each stage renders at, never by length."""

    def _graph(self, first: tuple[int, int], second: tuple[int, int]) -> dict:
        return {
            **_video_stage("a harbour", first, 81, "renders/scene"),
            **_renumbered(_video_stage("a forest", second, 81, "renders/scene"), 10),
        }

    def test_the_one_output_set_to_the_file_size_is_the_likely_output(self) -> None:
        with TempMediaFolder() as root:
            # The PNG fixture is 64x48.
            result = extract_workflow_prompts(
                _write(root, "scene_00001.png", self._graph((128, 96), (64, 48)))
            )

        self.assertEqual(result.matched_node_id, "22")
        self.assertTrue(result.matched_by_size)
        # The likely output opens selected, so it leads the list.
        self.assertEqual(result.branches[0].node_id, "22")

    def test_no_pick_when_the_size_fits_several_or_none(self) -> None:
        for first, second in (((64, 48), (64, 48)), ((128, 96), (32, 24))):
            with self.subTest(first=first, second=second), TempMediaFolder() as root:
                result = extract_workflow_prompts(
                    _write(root, "scene_00001.png", self._graph(first, second))
                )
                self.assertIsNone(result.matched_node_id)
                self.assertFalse(result.matched_by_size)

    def test_a_stage_of_unknown_size_is_never_ruled_out(self) -> None:
        graph = self._graph((128, 96), (64, 48))
        graph["11"]["inputs"]["width"] = ["99", 0]

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001.png", graph))

        self.assertIsNone(result.matched_node_id)

    def test_a_size_behind_a_switched_off_input_is_not_a_rendered_size(self) -> None:
        graph = self._graph((128, 96), (64, 48))
        graph["12"]["inputs"]["images"] = ["13", 0]
        graph["13"] = {
            "class_type": "ComfySwitchNode",
            "inputs": {"switch": False, "on_false": ["11", 0], "on_true": ["14", 0]},
        }
        graph["14"] = {
            "class_type": "ImageScale",
            "inputs": {"image": ["11", 0], "width": 64, "height": 48},
        }

        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "scene_00001.png", graph))

        self.assertEqual(result.matched_node_id, "22")


def _pairs(parameters: list) -> set[tuple[str, str]]:
    return {(parameter.label, parameter.value) for parameter in parameters}


def _map_edges(branch) -> set[tuple[str, str]]:
    return {(node.id, target) for node in branch.map for target in node.feeds}


def _map_status(branch) -> dict[str, str]:
    return {node.id: node.status for node in branch.map}


def _two_pass_graph(switch: object) -> dict:
    """A base pass, then a refining pass that a switch can route around."""
    return {
        "1": LOADER,
        "2": _encode("a lighthouse in a storm"),
        "3": _encode("blurry"),
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "seed": 7,
                "steps": 30,
                "denoise": 1.0,
                "sampler_name": "euler",
            },
        },
        "5": {"class_type": "LatentUpscaleBy", "inputs": {"samples": ["4", 0], "scale_by": 2}},
        "6": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"lora_name": "detail.safetensors", "strength_model": 0.8, "model": ["1", 0]},
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["6", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["5", 0],
                "seed": 7,
                "steps": 6,
                "denoise": 0.35,
                "sampler_name": "dpmpp_2m",
            },
        },
        "8": {
            "class_type": "ComfySwitchNode",
            "inputs": {"switch": switch, "on_false": ["4", 0], "on_true": ["7", 0]},
        },
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["1", 2]}},
        "10": _save("9", "storm"),
    }


class SamplingPassTests(unittest.TestCase):
    """Each sampling pass keeps its own settings, and a pass a switch routes around is skipped."""

    def _branch(self, graph: dict, workflow: dict | None = None):
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "storm_00001_.png", graph, workflow))
        return result.branches[0]

    def test_a_switched_off_pass_is_reported_as_skipped_with_its_own_settings(self) -> None:
        branch = self._branch(_two_pass_graph(False))

        self.assertEqual([stage.node_id for stage in branch.stages], ["4", "7"])
        self.assertEqual([stage.status for stage in branch.stages], ["ran", "switched_off"])
        base, refine = branch.stages
        self.assertLessEqual({("Steps", "30"), ("Sampler", "euler")}, _pairs(base.parameters))
        self.assertLessEqual(
            {("Steps", "6"), ("Denoise", "0.35"), ("Sampler", "dpmpp_2m")},
            _pairs(refine.parameters),
        )
        self.assertNotIn(("Steps", "6"), _pairs(base.parameters))
        self.assertEqual(refine.loras, ["detail.safetensors (0.8)"])
        self.assertEqual(base.loras, [])

    def test_settings_feeding_several_passes_are_shared(self) -> None:
        branch = self._branch(_two_pass_graph(False))

        self.assertIn(("Checkpoint", "landscape.safetensors"), _pairs(branch.parameters))
        self.assertFalse({"Steps", "Sampler", "Denoise"} & {p.label for p in branch.parameters})
        for stage in branch.stages:
            self.assertNotIn("Checkpoint", {parameter.label for parameter in stage.parameters})

    def test_a_switched_on_pass_runs_after_the_pass_it_refines(self) -> None:
        branch = self._branch(_two_pass_graph(True))

        self.assertEqual([stage.node_id for stage in branch.stages], ["4", "7"])
        self.assertEqual([stage.status for stage in branch.stages], ["ran", "ran"])

    def test_a_selector_that_cannot_be_read_skips_nothing(self) -> None:
        branch = self._branch(_two_pass_graph(["99", 0]))

        self.assertEqual([stage.status for stage in branch.stages], ["ran", "ran"])

    def test_an_indexed_switch_skips_every_input_but_the_selected_one(self) -> None:
        graph = {
            "1": LOADER,
            "2": _encode("a forest path in fog"),
            "3": _encode("a harbour at night"),
            "4": _sampler("2", "2", seed=1),
            "5": _sampler("3", "3", seed=2),
            "6": {
                "class_type": "ImpactSwitch",
                "inputs": {"select": 2, "input1": ["4", 0], "input2": ["5", 0]},
            },
            "7": _save("6", "storm"),
        }

        branch = self._branch(graph)

        self.assertEqual(
            {stage.node_id: stage.status for stage in branch.stages},
            {"4": "switched_off", "5": "ran"},
        )
        self.assertEqual([prompt.text for prompt in branch.prompts], ["a harbour at night"])
        self.assertLessEqual(
            {("4", "7"), ("5", "7"), ("prompt:3:positive", "5")}, _map_edges(branch)
        )
        self.assertEqual(_map_status(branch)["4"], "switched_off")

    def test_a_pass_is_grouped_by_its_innermost_subgraph(self) -> None:
        graph = _two_pass_graph(False)
        graph["9:4"] = graph.pop("4")
        graph["9:20:7"] = graph.pop("7")
        graph["8"]["inputs"].update(on_false=["9:4", 0], on_true=["9:20:7", 0])
        graph["5"]["inputs"]["samples"] = ["9:4", 0]
        workflow = {
            "nodes": [{"id": 9, "type": "outer"}],
            "definitions": {
                "subgraphs": [
                    {
                        "id": "outer",
                        "name": "Text to Image",
                        "nodes": [{"id": 20, "type": "inner"}],
                    },
                    {"id": "inner", "name": "Refine", "nodes": [{"id": 7, "type": "KSampler"}]},
                ]
            },
        }

        branch = self._branch(graph, workflow)

        self.assertEqual(
            [(stage.label, stage.group) for stage in branch.stages],
            [("KSampler", "Text to Image"), ("KSampler", "Refine")],
        )

    def test_the_map_links_models_loras_and_prompts_to_the_passes_they_feed(self) -> None:
        branch = self._branch(_two_pass_graph(False))

        kinds = {node.id: node.kind for node in branch.map}
        self.assertEqual(
            kinds,
            {
                "1": "model",
                "6": "loras",
                "4": "pass",
                "7": "pass",
                "prompt:2:positive": "prompt",
                "prompt:3:negative": "prompt",
                "10": "output",
            },
        )
        self.assertEqual(
            _map_edges(branch),
            {
                ("1", "4"),
                ("1", "6"),
                # A model-only LoRA leaves CLIP alone: pass 7's prompt still reads the checkpoint's.
                ("1", "7"),
                ("6", "7"),
                ("prompt:2:positive", "4"),
                ("prompt:2:positive", "7"),
                ("prompt:3:negative", "4"),
                ("prompt:3:negative", "7"),
                ("4", "7"),
                ("4", "10"),
                ("7", "10"),
            },
        )
        self.assertEqual(
            {key: _map_status(branch)[key] for key in ("1", "6", "7")},
            {"1": "ran", "6": "switched_off", "7": "switched_off"},
        )
        # Every box comes after the boxes that feed it.
        order = [node.id for node in branch.map]
        self.assertTrue(all(order.index(a) < order.index(b) for a, b in _map_edges(branch)))

    def test_a_chain_of_lora_loaders_is_one_box(self) -> None:
        graph = _two_pass_graph(True)
        graph["11"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"lora_name": "grain.safetensors", "strength_model": 0.5, "model": ["6", 0]},
        }
        graph["7"]["inputs"]["model"] = ["11", 0]

        branch = self._branch(graph)

        loras = [node for node in branch.map if node.kind == "loras"]
        self.assertEqual(
            [(node.label, node.detail) for node in loras],
            [("2 LoRAs", ["detail.safetensors (0.8)", "grain.safetensors (0.5)"])],
        )
        self.assertIn((loras[0].id, "7"), _map_edges(branch))

    def test_a_single_pass_keeps_every_setting_on_the_branch(self) -> None:
        graph = {key: _two_pass_graph(False)[key] for key in ("1", "2", "3", "9", "10")}
        graph["8"] = _sampler("2", "3")

        branch = self._branch(graph)

        self.assertEqual(branch.stages, [])
        self.assertIn(("Checkpoint", "landscape.safetensors"), _pairs(branch.parameters))
        self.assertIn(("Seed", "42"), _pairs(branch.parameters))
        # One pass still gets a map: what fed it matters as much as how many passes ran.
        self.assertEqual([node.kind for node in branch.map][-2:], ["pass", "output"])


def _reference_graph() -> dict:
    """An image stage whose result, with a loaded voice clip, guides a video stage."""
    reference = _sampler("2", "3")
    reference["_meta"] = {"title": "Reference image"}
    video = _sampler("7", "7", seed=7)
    video["inputs"].update(negative=["7", 1], latent_image=["7", 2])
    return {
        "1": LOADER,
        "2": _encode("a  red bicycle\nagainst a brick wall"),
        "3": _encode("blurry"),
        "4": reference,
        "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
        "6": _encode("the bicycle rolls down the street"),
        "7": {
            "class_type": "WanSoundImageToVideo",
            "inputs": {
                "positive": ["6", 0],
                "negative": ["3", 0],
                "vae": ["1", 2],
                "ref_image": ["5", 0],
                "audio_encoder_output": ["12", 0],
            },
        },
        "8": video,
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["1", 2]}},
        "10": _save("9", "bicycle"),
        "11": {"class_type": "LoadAudio", "inputs": {"audio": "voice.wav"}},
        "12": {"class_type": "AudioEncoderEncode", "inputs": {"audio": ["11", 0]}},
    }


class MapInputTests(unittest.TestCase):
    """Media coming into an output's stage: loaded files and earlier stages' results."""

    def _branch(self, graph: dict):
        with TempMediaFolder() as root:
            result = extract_workflow_prompts(_write(root, "bicycle_00001_.png", graph))
        return next(branch for branch in result.branches if branch.node_id == "10")

    def test_an_earlier_stage_result_is_an_input_named_by_its_prompt_and_stage(self) -> None:
        branch = self._branch(_reference_graph())

        inputs = {node.id: node for node in branch.map if node.kind == "input"}
        generated = inputs["5"]
        self.assertEqual(
            (generated.label, generated.media, generated.source),
            ("a red bicycle against a brick wall", "image", "Reference image"),
        )
        self.assertEqual(generated.detail, ["a  red bicycle\nagainst a brick wall"])
        self.assertIn(("5", "8"), _map_edges(branch))
        # The earlier stage's own boxes stay off this output's map.
        self.assertNotIn("4", {node.id for node in branch.map})

    def test_a_loaded_audio_file_is_an_audio_input(self) -> None:
        branch = self._branch(_reference_graph())

        audio = next(node for node in branch.map if node.id == "11")
        self.assertEqual(
            (audio.kind, audio.label, audio.media, audio.source), ("input", "voice", "audio", None)
        )
        self.assertIn(("11", "8"), _map_edges(branch))

    def test_a_latent_handed_on_from_an_earlier_pass_is_no_input(self) -> None:
        graph = _reference_graph()
        graph["8"]["inputs"]["latent_image"] = ["4", 0]

        branch = self._branch(graph)

        self.assertNotIn("4", {node.id for node in branch.map if node.kind == "input"})
        self.assertEqual(
            {node.media for node in branch.map if node.kind == "input"}, {"image", "audio"}
        )


def _one_pass_graph() -> dict:
    """What the prompt keeps of a pass followed by a bypassed one: the save reads the decode."""
    return {
        "1": LOADER,
        "2": _encode("a dancer on a stage"),
        "3": _encode("blurry"),
        "4": _sampler("2", "3"),
        "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
        "7": _save("5", "dancer"),
    }


class BypassedPassTests(unittest.TestCase):
    """The prompt drops a bypassed node; the editor workflow still has it, with its links."""

    def _branch(self, workflow: dict):
        with TempMediaFolder() as root:
            media = _write(root, "dancer_00001_.png", _one_pass_graph(), workflow)
            return extract_workflow_prompts(media).branches[0]

    def test_a_bypassed_detailer_is_a_bypassed_pass_with_its_widget_settings(self) -> None:
        workflow = {
            "nodes": [
                {
                    "id": 6,
                    "type": "FaceDetailer",
                    "mode": 4,
                    "inputs": [{"name": "image", "link": 1}, {"name": "model", "link": 2}],
                    "widgets_values_named": {"seed": 9, "steps": 8, "denoise": 0.4},
                },
                {
                    "id": 7,
                    "type": "SaveImage",
                    "mode": 0,
                    "inputs": [{"name": "images", "link": 3}],
                },
            ],
            "links": [[1, 5, 0, 6, 0, "IMAGE"], [2, 1, 0, 6, 1, "MODEL"], [3, 6, 0, 7, 0, "IMAGE"]],
        }

        branch = self._branch(workflow)

        self.assertEqual(
            [(stage.node_id, stage.status) for stage in branch.stages],
            [("4", "ran"), ("6", "bypassed")],
        )
        base, detailer = branch.stages
        self.assertEqual(detailer.label, "FaceDetailer")
        self.assertEqual(
            _pairs(detailer.parameters), {("Seed", "9"), ("Steps", "8"), ("Denoise", "0.4")}
        )
        self.assertIn(("Steps", "20"), _pairs(base.parameters))
        # The prompt links around the bypassed detailer, so the base pass also feeds the output.
        self.assertLessEqual({("4", "6"), ("4", "7"), ("6", "7"), ("1", "6")}, _map_edges(branch))
        self.assertEqual(_map_status(branch)["6"], "bypassed")
        self.assertIn(("Checkpoint", "landscape.safetensors"), _pairs(branch.parameters))
        self.assertEqual(
            [prompt.text for prompt in branch.prompts], ["a dancer on a stage", "blurry"]
        )

    def test_a_pass_inside_a_bypassed_subgraph_resolves_through_its_boundary(self) -> None:
        workflow = {
            "nodes": [
                {"id": 9, "type": "refine", "mode": 4, "inputs": [{"name": "latent", "link": 1}]},
                {
                    "id": 5,
                    "type": "VAEDecode",
                    "mode": 0,
                    "inputs": [{"name": "samples", "link": 2}],
                },
            ],
            "links": [[1, 4, 0, 9, 0, "LATENT"], [2, 9, 0, 5, 0, "LATENT"]],
            "definitions": {
                "subgraphs": [
                    {
                        "id": "refine",
                        "name": "Refine",
                        "inputs": [{"name": "latent"}],
                        "nodes": [
                            {
                                "id": 3,
                                "type": "KSampler",
                                "mode": 0,
                                "inputs": [{"name": "latent_image", "link": 10}],
                                "widgets_values_named": {"steps": 6, "sampler_name": "dpmpp_2m"},
                            }
                        ],
                        "links": [
                            {
                                "id": 10,
                                "origin_id": -10,
                                "origin_slot": 0,
                                "target_id": 3,
                                "target_slot": 0,
                            },
                            {
                                "id": 11,
                                "origin_id": 3,
                                "origin_slot": 0,
                                "target_id": -20,
                                "target_slot": 0,
                            },
                        ],
                    }
                ]
            },
        }

        branch = self._branch(workflow)

        self.assertEqual(
            [(stage.node_id, stage.status, stage.group) for stage in branch.stages],
            [("4", "ran", None), ("9:3", "bypassed", "Refine")],
        )
        self.assertEqual(
            _pairs(branch.stages[1].parameters), {("Steps", "6"), ("Sampler", "dpmpp_2m")}
        )

    def test_a_workflow_without_bypassed_nodes_changes_nothing(self) -> None:
        workflow = {"nodes": [{"id": 7, "type": "SaveImage", "mode": 0}], "links": []}

        self.assertEqual(self._branch(workflow).stages, [])


if __name__ == "__main__":
    unittest.main()
