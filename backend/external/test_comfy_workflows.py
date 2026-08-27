import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from external.comfy_workflows import (
    ComfyWorkflowError,
    build_comfy_prompt,
    list_comfy_presets,
    load_comfy_workflow,
    parse_comfy_workflow,
    read_comfy_preset_text,
)


def node(class_type: str, inputs: dict, title: str | None = None) -> dict:
    entry: dict = {"class_type": class_type, "inputs": inputs}
    if title is not None:
        entry["_meta"] = {"title": title}
    return entry


def graph(**overrides: dict) -> dict:
    base = {
        "1": node("LoadImage", {"image": "example.png", "upload": "image"}),
        "2": node(
            "ImageScaleBy", {"upscale_method": "lanczos", "scale_by": 2.0, "image": ["1", 0]}
        ),
        "3": node("SaveImage", {"filename_prefix": "out", "images": ["2", 0]}),
    }
    base.update(overrides)
    return base


def parse(payload: dict, source: str = "upscale-2x"):
    return parse_comfy_workflow(json.dumps(payload), source=source)


class ResolveRolesTests(unittest.TestCase):
    def test_a_single_loader_and_saver_need_no_titles(self) -> None:
        workflow = parse(graph())

        self.assertEqual(workflow.input_node, "1")
        self.assertEqual(workflow.output_node, "3")

    def test_titles_win_over_class_sniffing(self) -> None:
        payload = graph(
            **{
                "1": node("LoadImage", {"image": "a.png"}),
                "4": node("LoadImage", {"image": "b.png"}, "DataForge Input"),
            }
        )

        self.assertEqual(parse(payload).input_node, "4")

    def test_two_loaders_without_a_title_name_the_fix(self) -> None:
        payload = graph(**{"4": node("LoadImage", {"image": "b.png"})})

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        message = str(caught.exception)
        self.assertIn("2 image input nodes", message)
        self.assertIn("DataForge Input", message)

    def test_two_nodes_sharing_the_marker_are_refused(self) -> None:
        payload = graph(
            **{
                "1": node("LoadImage", {"image": "a.png"}, "DataForge Input"),
                "4": node("LoadImage", {"image": "b.png"}, "DataForge Input"),
            }
        )

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("Only one node can be the image input", str(caught.exception))

    def test_a_graph_with_no_loader_names_the_fix(self) -> None:
        payload = {"3": node("SaveImage", {"filename_prefix": "out"})}

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("no image input node", str(caught.exception))

    def test_a_preview_node_counts_as_the_output(self) -> None:
        payload = {
            "1": node("LoadImage", {"image": "a.png"}),
            "3": node("PreviewImage", {"images": ["1", 0]}),
        }

        # PreviewImage has no filename_prefix; the output is read back out of history.
        self.assertEqual(parse(payload).output_node, "3")

    def test_an_optional_seed_node_is_found_by_title(self) -> None:
        payload = graph(
            **{"5": node("KSampler", {"seed": 1, "steps": 20}, "DataForge Seed")},
        )

        self.assertEqual(parse(payload).seed_nodes, ("5",))

    def test_a_titled_seed_node_without_a_seed_input_is_refused(self) -> None:
        payload = graph(**{"5": node("KSampler", {"steps": 20}, "DataForge Seed")})

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("no seed input", str(caught.exception))


class ParseFailureTests(unittest.TestCase):
    def test_the_editor_format_is_named_as_such(self) -> None:
        # The message has to name the right ComfyUI menu item rather than say "invalid".
        raw = json.dumps({"last_node_id": 9, "nodes": [], "links": []})

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse_comfy_workflow(raw, source="upscale-2x")

        message = str(caught.exception)
        self.assertIn("Save (API Format)", message)
        self.assertIn("editor workflow", message)

    def test_broken_json_reports_the_parse_error(self) -> None:
        with self.assertRaises(ComfyWorkflowError) as caught:
            parse_comfy_workflow("{not json", source="upscale-2x")

        self.assertIn("not valid JSON", str(caught.exception))

    def test_json_that_holds_no_nodes_is_refused(self) -> None:
        with self.assertRaises(ComfyWorkflowError) as caught:
            parse_comfy_workflow(json.dumps({"hello": "world"}), source="upscale-2x")

        self.assertIn("no ComfyUI nodes", str(caught.exception))

    def test_an_input_node_taking_no_image_is_refused(self) -> None:
        payload = graph(**{"1": node("LoadImage", {"upload": "image"}, "DataForge Input")})

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("no image filename", str(caught.exception))

    def test_the_preset_name_appears_in_every_message(self) -> None:
        with self.assertRaises(ComfyWorkflowError) as caught:
            parse_comfy_workflow("{", source="my-preset")

        self.assertIn('"my-preset"', str(caught.exception))


class PromptNodeTests(unittest.TestCase):
    def test_a_prompt_node_whose_text_is_wired_in_is_refused(self) -> None:
        # A linked input is ["node", slot]; writing over it would be dropped without a word.
        payload = graph(**{"7": node("CLIPTextEncode", {"text": ["9", 0]}, "DataForge Prompt")})

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse_comfy_workflow(json.dumps(payload), source="my-preset")

        self.assertIn("DataForge Prompt", str(caught.exception))
        self.assertIn("no text input", str(caught.exception))

    def test_a_prompt_node_is_optional(self) -> None:
        self.assertIsNone(parse(graph()).prompt_node)

    def test_two_nodes_with_the_title_leave_it_unresolved(self) -> None:
        """Same rule the seed node follows: ambiguous means no node, not a guess."""
        payload = graph(
            **{
                "7": node("CLIPTextEncode", {"text": "one"}, "DataForge Prompt"),
                "8": node("CLIPTextEncode", {"text": "two"}, "DataForge Prompt"),
            }
        )

        self.assertIsNone(parse(payload).prompt_node)


class BuildPromptTests(unittest.TestCase):
    def test_the_image_and_prefix_are_filled_in(self) -> None:
        workflow = parse(graph())

        prompt = build_comfy_prompt(
            workflow,
            image_ref="dataforge/ab12_00001.png",
            filename_prefix="DataForge/ab12/photo",
        )

        self.assertEqual(prompt["1"]["inputs"]["image"], "dataforge/ab12_00001.png")
        self.assertEqual(prompt["3"]["inputs"]["filename_prefix"], "DataForge/ab12/photo")

    def test_the_source_graph_is_never_mutated(self) -> None:
        payload = graph()
        workflow = parse(payload)

        build_comfy_prompt(workflow, image_ref="new.png", filename_prefix="out")

        # The parsed workflow is reused; a leaked patch would have image two inherit image one's values.
        self.assertEqual(workflow.prompt["1"]["inputs"]["image"], "example.png")

    def test_the_presets_own_seed_is_left_alone_by_default(self) -> None:
        workflow = parse(graph(**{"5": node("KSampler", {"seed": 99}, "DataForge Seed")}))

        prompt = build_comfy_prompt(workflow, image_ref="a.png", filename_prefix="out")

        self.assertEqual(prompt["5"]["inputs"]["seed"], 99)

    def test_a_supplied_seed_overwrites_the_titled_node(self) -> None:
        workflow = parse(graph(**{"5": node("KSampler", {"seed": 99}, "DataForge Seed")}))

        prompt = build_comfy_prompt(workflow, image_ref="a.png", filename_prefix="out", seed=1234)

        self.assertEqual(prompt["5"]["inputs"]["seed"], 1234)

    def test_a_noise_seed_input_is_patched_too(self) -> None:
        workflow = parse(graph(**{"5": node("SamplerCustom", {"noise_seed": 5}, "DataForge Seed")}))

        prompt = build_comfy_prompt(workflow, image_ref="a.png", filename_prefix="out", seed=77)

        self.assertEqual(prompt["5"]["inputs"]["noise_seed"], 77)

    def test_the_presets_own_prompt_is_left_alone_by_default(self) -> None:
        workflow = parse(
            graph(**{"7": node("CLIPTextEncode", {"text": "as saved"}, "DataForge Prompt")})
        )

        prompt = build_comfy_prompt(workflow, image_ref="a.png", filename_prefix="out")

        self.assertEqual(prompt["7"]["inputs"]["text"], "as saved")

    def test_supplied_text_overwrites_the_titled_prompt_node(self) -> None:
        workflow = parse(
            graph(**{"7": node("CLIPTextEncode", {"text": "as saved"}, "DataForge Prompt")})
        )

        prompt = build_comfy_prompt(
            workflow, image_ref="a.png", filename_prefix="out", prompt_text="sharp photograph"
        )

        self.assertEqual(prompt["7"]["inputs"]["text"], "sharp photograph")

    def test_a_preview_output_survives_the_prefix_patch(self) -> None:
        workflow = parse(
            {
                "1": node("LoadImage", {"image": "a.png"}),
                "3": node("PreviewImage", {"images": ["1", 0]}),
            }
        )

        prompt = build_comfy_prompt(workflow, image_ref="b.png", filename_prefix="out")

        self.assertNotIn("filename_prefix", prompt["3"]["inputs"])


class PresetDiscoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.folder = Path(self._temp.name)
        self._previous = __import__("os").environ.get("COMFY_WORKFLOWS_DIR")
        __import__("os").environ["COMFY_WORKFLOWS_DIR"] = str(self.folder)

    def tearDown(self) -> None:
        import os

        if self._previous is None:
            os.environ.pop("COMFY_WORKFLOWS_DIR", None)
        else:
            os.environ["COMFY_WORKFLOWS_DIR"] = self._previous
        self._temp.cleanup()

    def write(self, name: str, payload: dict | str) -> Path:
        path = self.folder / f"{name}.json"
        path.write_text(
            payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8"
        )
        return path

    def test_presets_are_listed_by_filename_stem(self) -> None:
        self.write("upscale-2x", graph())
        self.write("fix-faces", graph())

        self.assertEqual(
            [preset.name for preset in list_comfy_presets()], ["fix-faces", "upscale-2x"]
        )

    def test_a_broken_preset_still_lists(self) -> None:
        # Listing does not parse; a broken preset is refused at queue time.
        self.write("broken", "{not json")

        self.assertEqual([preset.name for preset in list_comfy_presets()], ["broken"])

    def test_a_missing_folder_lists_nothing(self) -> None:
        import os

        os.environ["COMFY_WORKFLOWS_DIR"] = str(self.folder / "nope")

        self.assertEqual(list_comfy_presets(), [])

    def test_loading_parses_the_named_preset(self) -> None:
        self.write("upscale-2x", graph())

        self.assertEqual(load_comfy_workflow("upscale-2x").preset, "upscale-2x")

    def test_an_unknown_preset_says_so(self) -> None:
        with self.assertRaises(ComfyWorkflowError) as caught:
            read_comfy_preset_text("nope")

        self.assertIn("No workflow preset", str(caught.exception))

    def test_a_name_that_walks_the_filesystem_is_refused(self) -> None:
        for name in ("", "..", "../secrets", r"..\secrets", "sub/preset"):
            with self.subTest(name=name), self.assertRaises(ComfyWorkflowError):
                read_comfy_preset_text(name)


class ShippedExampleTests(unittest.TestCase):
    def test_the_example_preset_parses(self) -> None:
        # The shipped example is the fixture; a broken one fails here first.
        path = Path(__file__).resolve().parents[2] / "comfy-workflows" / "example-lanczos-2x.json"
        workflow = parse_comfy_workflow(path.read_text(encoding="utf-8"), source=path.stem)

        self.assertEqual(workflow.input_node, "1")
        self.assertEqual(workflow.output_node, "3")


if __name__ == "__main__":
    unittest.main()
