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
    preset_roles,
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


def video_graph(**overrides: dict) -> dict:
    """Shaped like the shipped video preset: every role titled, and the rate behind a math node."""
    base = {
        "8": node(
            "VHS_LoadVideo",
            {"video": "example.mp4", "force_rate": ["13", 0], "frame_load_cap": 0},
            "DataForge Input",
        ),
        "5": node("RIFE VFI", {"multiplier": ["15", 0], "frames": ["8", 0]}),
        "11": node(
            "VHS_VideoCombine",
            {
                "frame_rate": ["16", 0],
                "filename_prefix": "video/ComfyUI",
                "format": "video/h264-mp4",
                "images": ["5", 0],
            },
            "DataForge Output",
        ),
        "10": node("SeedNode", {"seed": 42}, "DataForge Seed"),
        "13": node("FloatConstant", {"value": 24}, "DataForge FPS"),
        "15": node("INTConstant", {"value": 2}, "DataForge Multiplier"),
        "16": node("ComfyMathExpression", {"expression": "round(a * b)", "values.a": ["13", 0]}),
    }
    base.update(overrides)
    return base


class VideoGraphTests(unittest.TestCase):
    def test_every_role_resolves_from_its_title(self) -> None:
        workflow = parse(video_graph())

        self.assertEqual(workflow.input_node, "8")
        self.assertEqual(workflow.input_key, "video")
        self.assertEqual(workflow.output_node, "11")
        self.assertEqual(workflow.seed_nodes, ("10",))
        self.assertEqual((workflow.fps_node, workflow.fps_key), ("13", "value"))

    def test_a_still_loader_still_names_its_own_widget(self) -> None:
        self.assertEqual(parse(graph()).input_key, "image")

    def test_an_untitled_video_graph_resolves_by_class(self) -> None:
        payload = {
            "8": node("VHS_LoadVideo", {"video": "example.mp4"}),
            "11": node("VHS_VideoCombine", {"frame_rate": 24, "filename_prefix": "out"}),
        }

        workflow = parse(payload)

        self.assertEqual((workflow.input_node, workflow.output_node), ("8", "11"))

    def test_an_untitled_preview_beside_the_combine_names_the_fix(self) -> None:
        payload = {
            "8": node("VHS_LoadVideo", {"video": "example.mp4"}),
            "9": node("PreviewImage", {"images": ["8", 0]}),
            "11": node("VHS_VideoCombine", {"frame_rate": 24, "filename_prefix": "out"}),
        }

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("2 output nodes", str(caught.exception))

    def test_an_unwritable_multiplier_title_is_ignored(self) -> None:
        """DataForge writes no multiplier, so an unknown DataForge title must not refuse."""
        parse(video_graph())

    def test_a_linked_rate_input_is_refused(self) -> None:
        # Writing over a link would be dropped without a word, exactly like the prompt node.
        payload = video_graph(**{"13": node("FloatConstant", {"value": ["9", 0]}, "DataForge FPS")})

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("DataForge FPS", str(caught.exception))

    def test_a_loader_with_neither_widget_names_both(self) -> None:
        payload = video_graph(
            **{"8": node("VHS_LoadVideo", {"frame_load_cap": 0}, "DataForge Input")}
        )

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("'image' or 'video'", str(caught.exception))


class VideoPromptTests(unittest.TestCase):
    def test_the_measured_rate_overwrites_the_presets_constant(self) -> None:
        workflow = parse(video_graph())

        prompt = build_comfy_prompt(
            workflow, media_ref="dataforge/clip.mp4", filename_prefix="out", frame_rate=30.0
        )

        self.assertEqual(prompt["13"]["inputs"]["value"], 30.0)
        self.assertEqual(prompt["8"]["inputs"]["video"], "dataforge/clip.mp4")

    def test_an_unmeasured_rate_leaves_the_presets_constant_alone(self) -> None:
        workflow = parse(video_graph())

        prompt = build_comfy_prompt(workflow, media_ref="a.mp4", filename_prefix="out")

        self.assertEqual(prompt["13"]["inputs"]["value"], 24)

    def test_the_multiplier_is_never_written(self) -> None:
        workflow = parse(video_graph())

        prompt = build_comfy_prompt(
            workflow, media_ref="a.mp4", filename_prefix="out", frame_rate=60.0
        )

        self.assertEqual(prompt["15"]["inputs"]["value"], 2)

    def test_a_rate_for_a_graph_without_the_node_changes_nothing(self) -> None:
        workflow = parse(graph())

        prompt = build_comfy_prompt(
            workflow, media_ref="a.png", filename_prefix="out", frame_rate=30.0
        )

        self.assertEqual(
            prompt, build_comfy_prompt(workflow, media_ref="a.png", filename_prefix="out")
        )


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
        self.assertIn("has 2 input nodes", message)
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

        self.assertIn("Only one node can be the input", str(caught.exception))

    def test_a_graph_with_no_loader_names_the_fix(self) -> None:
        payload = {"3": node("SaveImage", {"filename_prefix": "out"})}

        with self.assertRaises(ComfyWorkflowError) as caught:
            parse(payload)

        self.assertIn("has no input node", str(caught.exception))

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

        self.assertIn("takes no filename under", str(caught.exception))

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
            media_ref="dataforge/ab12_00001.png",
            filename_prefix="DataForge/ab12/photo",
        )

        self.assertEqual(prompt["1"]["inputs"]["image"], "dataforge/ab12_00001.png")
        self.assertEqual(prompt["3"]["inputs"]["filename_prefix"], "DataForge/ab12/photo")

    def test_the_source_graph_is_never_mutated(self) -> None:
        payload = graph()
        workflow = parse(payload)

        build_comfy_prompt(workflow, media_ref="new.png", filename_prefix="out")

        # The parsed workflow is reused; a leaked patch would have image two inherit image one's values.
        self.assertEqual(workflow.prompt["1"]["inputs"]["image"], "example.png")

    def test_the_presets_own_seed_is_left_alone_by_default(self) -> None:
        workflow = parse(graph(**{"5": node("KSampler", {"seed": 99}, "DataForge Seed")}))

        prompt = build_comfy_prompt(workflow, media_ref="a.png", filename_prefix="out")

        self.assertEqual(prompt["5"]["inputs"]["seed"], 99)

    def test_a_supplied_seed_overwrites_the_titled_node(self) -> None:
        workflow = parse(graph(**{"5": node("KSampler", {"seed": 99}, "DataForge Seed")}))

        prompt = build_comfy_prompt(workflow, media_ref="a.png", filename_prefix="out", seed=1234)

        self.assertEqual(prompt["5"]["inputs"]["seed"], 1234)

    def test_a_noise_seed_input_is_patched_too(self) -> None:
        workflow = parse(graph(**{"5": node("SamplerCustom", {"noise_seed": 5}, "DataForge Seed")}))

        prompt = build_comfy_prompt(workflow, media_ref="a.png", filename_prefix="out", seed=77)

        self.assertEqual(prompt["5"]["inputs"]["noise_seed"], 77)

    def test_the_presets_own_prompt_is_left_alone_by_default(self) -> None:
        workflow = parse(
            graph(**{"7": node("CLIPTextEncode", {"text": "as saved"}, "DataForge Prompt")})
        )

        prompt = build_comfy_prompt(workflow, media_ref="a.png", filename_prefix="out")

        self.assertEqual(prompt["7"]["inputs"]["text"], "as saved")

    def test_supplied_text_overwrites_the_titled_prompt_node(self) -> None:
        workflow = parse(
            graph(**{"7": node("CLIPTextEncode", {"text": "as saved"}, "DataForge Prompt")})
        )

        prompt = build_comfy_prompt(
            workflow, media_ref="a.png", filename_prefix="out", prompt_text="sharp photograph"
        )

        self.assertEqual(prompt["7"]["inputs"]["text"], "sharp photograph")

    def test_a_preview_output_survives_the_prefix_patch(self) -> None:
        workflow = parse(
            {
                "1": node("LoadImage", {"image": "a.png"}),
                "3": node("PreviewImage", {"images": ["1", 0]}),
            }
        )

        prompt = build_comfy_prompt(workflow, media_ref="b.png", filename_prefix="out")

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
        path = Path(__file__).resolve().parents[2] / "comfy_workflows" / "example_lanczos_2x.json"
        workflow = parse_comfy_workflow(path.read_text(encoding="utf-8"), source=path.stem)

        self.assertEqual(workflow.input_node, "1")
        self.assertEqual(workflow.output_node, "3")


if __name__ == "__main__":
    unittest.main()


class PresetRoleTests(unittest.TestCase):
    """The dialog greys out a field the preset cannot take, so listing has to report both roles."""

    def write(self, folder: Path, name: str, payload: object) -> Path:
        path = folder / f"{name}.json"
        path.write_text(
            payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8"
        )
        return path

    def test_a_preset_reports_the_roles_it_carries(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            both = self.write(
                Path(temp),
                "both",
                graph(
                    **{
                        "5": node("KSampler", {"seed": 1}, "DataForge Seed"),
                        "7": node("CLIPTextEncode", {"text": "as saved"}, "DataForge Prompt"),
                    }
                ),
            )

            self.assertEqual(preset_roles(both), (True, True))

    def test_a_preset_without_either_node_reports_false(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            plain = self.write(Path(temp), "plain", graph())

            self.assertEqual(preset_roles(plain), (False, False))

    def test_an_unparseable_preset_reports_unknown_rather_than_no(self) -> None:
        # None leaves the fields live, so the queue-time message is what names the fix.
        with tempfile.TemporaryDirectory() as temp:
            broken = self.write(Path(temp), "broken", "{not json")

            self.assertEqual(preset_roles(broken), (None, None))

    def test_a_missing_preset_reports_unknown(self) -> None:
        self.assertEqual(preset_roles(Path("no-such-preset.json")), (None, None))
