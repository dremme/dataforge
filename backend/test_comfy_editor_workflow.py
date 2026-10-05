from __future__ import annotations

import json
import unittest

from comfy_editor_workflow import workflow_for_output


def _node(node_id: int, node_type: str, inputs=(), outputs=(), **extra) -> dict:
    """``inputs`` are link ids (or None); ``outputs`` are lists of link ids per slot."""
    return {
        "id": node_id,
        "type": node_type,
        "pos": [node_id * 100, 0],
        "inputs": [{"name": f"in{index}", "link": link} for index, link in enumerate(inputs)],
        "outputs": [
            {"name": f"out{index}", "links": list(links)} for index, links in enumerate(outputs)
        ],
        **extra,
    }


def _workflow(nodes: list[dict], links: list[list], **extra) -> str:
    return json.dumps({"version": 0.4, "nodes": nodes, "links": links, "extra": {}, **extra})


def _trim(raw: str, node_id: str) -> dict:
    trimmed = workflow_for_output(raw, node_id)
    assert trimmed is not None
    return json.loads(trimmed)


def _types(workflow: dict) -> list[str]:
    return sorted(node["type"] for node in workflow["nodes"])


class WorkflowForOutputTests(unittest.TestCase):
    def test_keeps_only_what_the_output_depends_on(self) -> None:
        raw = _workflow(
            [
                _node(1, "CheckpointLoaderSimple", outputs=[[1, 3]]),
                _node(2, "KSampler", inputs=[1], outputs=[[2]]),
                _node(3, "KSampler", inputs=[3], outputs=[[4]]),
                _node(4, "SaveImage", inputs=[2]),
                _node(5, "PreviewImage", inputs=[4]),
            ],
            [
                [1, 1, 0, 2, 0, "MODEL"],
                [2, 2, 0, 4, 0, "IMAGE"],
                [3, 1, 0, 3, 0, "MODEL"],
                [4, 3, 0, 5, 0, "IMAGE"],
            ],
            groups=[
                {"title": "Kept", "bounding": [350, -50, 100, 100]},
                {"title": "Other branch", "bounding": [450, -50, 100, 100]},
            ],
        )

        workflow = _trim(raw, "4")

        self.assertEqual(_types(workflow), ["CheckpointLoaderSimple", "KSampler", "SaveImage"])
        self.assertEqual([link[0] for link in workflow["links"]], [1, 2])
        loader = next(node for node in workflow["nodes"] if node["id"] == 1)
        self.assertEqual(loader["outputs"][0]["links"], [1])
        self.assertEqual([group["title"] for group in workflow["groups"]], ["Kept"])

    def test_get_nodes_are_rewired_to_the_set_source(self) -> None:
        raw = _workflow(
            [
                _node(1, "CheckpointLoaderSimple", outputs=[[1]]),
                _node(2, "SetNode", inputs=[1], widgets_values=["model"]),
                _node(3, "GetNode", outputs=[[2]], widgets_values=["model"]),
                _node(4, "KSampler", inputs=[2], outputs=[[3]]),
                _node(5, "SaveImage", inputs=[3]),
            ],
            [
                [1, 1, 0, 2, 0, "MODEL"],
                [2, 3, 0, 4, 0, "MODEL"],
                [3, 4, 0, 5, 0, "IMAGE"],
            ],
        )

        workflow = _trim(raw, "5")

        self.assertEqual(_types(workflow), ["CheckpointLoaderSimple", "KSampler", "SaveImage"])
        self.assertIn([2, 1, 0, 4, 0, "MODEL"], workflow["links"])
        loader = next(node for node in workflow["nodes"] if node["id"] == 1)
        self.assertEqual(loader["outputs"][0]["links"], [2])

    def test_an_ambiguous_get_name_keeps_its_nodes(self) -> None:
        raw = _workflow(
            [
                _node(1, "CheckpointLoaderSimple", outputs=[[1, 4]]),
                _node(2, "SetNode", inputs=[1], widgets_values=["model"]),
                _node(6, "SetNode", inputs=[4], widgets_values=["model"]),
                _node(3, "GetNode", outputs=[[2]], widgets_values=["model"]),
                _node(5, "SaveImage", inputs=[2]),
            ],
            [[1, 1, 0, 2, 0, "MODEL"], [4, 1, 0, 6, 0, "MODEL"], [2, 3, 0, 5, 0, "MODEL"]],
        )

        workflow = _trim(raw, "5")

        self.assertEqual(
            _types(workflow),
            ["CheckpointLoaderSimple", "GetNode", "SaveImage", "SetNode", "SetNode"],
        )

    def test_a_subgraph_reading_an_outer_set_keeps_it(self) -> None:
        definition = {
            "id": "sub-1",
            "nodes": [
                {"id": 1, "type": "GetNode", "widgets_values": ["model"]},
                # A Set inside the subgraph shadows the outer one of the same name.
                {"id": 2, "type": "SetNode", "widgets_values": ["vae"]},
                {"id": 3, "type": "GetNode", "widgets_values": ["vae"]},
            ],
        }
        raw = _workflow(
            [
                _node(1, "CheckpointLoaderSimple", outputs=[[1, 2]]),
                _node(2, "SetNode", inputs=[1], widgets_values=["model"]),
                _node(3, "SetNode", inputs=[2], widgets_values=["vae"]),
                _node(4, "sub-1"),
            ],
            [[1, 1, 0, 2, 0, "MODEL"], [2, 1, 2, 3, 0, "VAE"]],
            definitions={"subgraphs": [definition]},
        )

        workflow = _trim(raw, "4:9")

        self.assertEqual(_types(workflow), ["CheckpointLoaderSimple", "SetNode", "sub-1"])
        self.assertEqual(workflow["definitions"]["subgraphs"], [definition])

    def test_native_reroutes_follow_their_links(self) -> None:
        raw = _workflow(
            [
                _node(1, "LoadImage", outputs=[[1, 2]]),
                _node(2, "SaveImage", inputs=[1]),
                _node(3, "PreviewImage", inputs=[2]),
            ],
            [[1, 1, 0, 2, 0, "IMAGE"], [2, 1, 0, 3, 0, "IMAGE"]],
        )
        parsed = json.loads(raw)
        parsed["extra"] = {
            "reroutes": [
                {"id": 1, "pos": [0, 0], "linkIds": [1, 2]},
                {"id": 2, "parentId": 1, "pos": [0, 0], "linkIds": [1]},
                {"id": 3, "pos": [0, 0], "linkIds": [2]},
            ],
            "linkExtensions": [{"id": 1, "parentId": 2}, {"id": 2, "parentId": 3}],
        }

        workflow = _trim(json.dumps(parsed), "2")

        self.assertEqual(
            workflow["extra"]["reroutes"],
            [
                {"id": 1, "pos": [0, 0], "linkIds": [1]},
                {"id": 2, "parentId": 1, "pos": [0, 0], "linkIds": [1]},
            ],
        )
        self.assertEqual(workflow["extra"]["linkExtensions"], [{"id": 1, "parentId": 2}])

    def test_an_output_missing_from_the_workflow_is_none(self) -> None:
        raw = _workflow([_node(1, "SaveImage")], [])

        self.assertIsNone(workflow_for_output(raw, "7"))
        self.assertIsNone(workflow_for_output("not json", "1"))


if __name__ == "__main__":
    unittest.main()
