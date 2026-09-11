"""Discover, validate and patch the ComfyUI workflow presets a prep job runs."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from comfy_settings import get_comfy_workflows_dir

WORKFLOW_EXTENSION = ".json"

MAX_WORKFLOW_BYTES = 4 * 1024 * 1024

INPUT_NODE_TITLE = "DataForge Input"
OUTPUT_NODE_TITLE = "DataForge Output"
SEED_NODE_TITLE = "DataForge Seed"
PROMPT_NODE_TITLE = "DataForge Prompt"
FPS_NODE_TITLE = "DataForge FPS"

#: The filename widget each known loader takes; the keys are also the inferrable input classes.
INPUT_KEYS = {"LoadImage": "image", "VHS_LoadVideo": "video"}
INPUT_CLASSES = frozenset(INPUT_KEYS)

#: These read a path off the filesystem, and DataForge only ever has an uploaded name to give them.
PATH_LOADERS = frozenset({"VHS_LoadVideoPath", "VHS_LoadImagePath"})
OUTPUT_CLASSES = frozenset(
    {
        "SaveImage",
        "PreviewImage",
        "SaveImageWebsocket",
        "VHS_VideoCombine",
        "SaveVideo",
        "SaveWEBM",
        "SaveAnimatedWEBP",
        "SaveAnimatedPNG",
    }
)

# PreviewImage has no filename_prefix; the output ref is read back out of history.
_NO_PREFIX_CLASSES = frozenset({"PreviewImage", "SaveImageWebsocket"})

INPUT_WIDGET_KEYS = ("image", "video")

_SEED_INPUT_KEYS = ("seed", "noise_seed")

_FPS_INPUT_KEYS = ("value", "fps", "frame_rate")

_EXPORT_HINT = "Use Save (API Format) in ComfyUI, not the editor's Save."


class ComfyWorkflowError(Exception):
    """A preset that cannot be run, with a message naming the fix."""


@dataclass(frozen=True)
class ComfyPreset:
    """One preset file, as listed for the dialog. Not parsed."""

    name: str
    path: Path
    modified_at: float


@dataclass(frozen=True)
class ComfyWorkflow:
    """A parsed preset with its roles resolved."""

    preset: str
    prompt: dict[str, Any]
    input_node: str
    input_key: str
    output_node: str
    seed_nodes: tuple[str, ...]
    prompt_node: str | None
    fps_node: str | None = None
    fps_key: str | None = None


def _node_title(node: dict[str, Any]) -> str:
    meta = node.get("_meta")
    title = meta.get("title") if isinstance(meta, dict) else None
    return title.strip() if isinstance(title, str) else ""


def _nodes(prompt: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    return [
        (node_id, node)
        for node_id, node in prompt.items()
        if isinstance(node, dict) and isinstance(node.get("class_type"), str)
    ]


def _node_inputs(node: dict[str, Any]) -> dict[str, Any]:
    inputs = node.get("inputs")
    return inputs if isinstance(inputs, dict) else {}


def _is_editor_format(payload: object) -> bool:
    """The editor's own save format, which ComfyUI's API cannot run."""
    return isinstance(payload, dict) and ("nodes" in payload or "last_node_id" in payload)


def _resolve_role(
    preset: str,
    prompt: dict[str, Any],
    *,
    title: str,
    classes: frozenset[str],
    role: str,
) -> str:
    titled = [node_id for node_id, node in _nodes(prompt) if _node_title(node) == title]
    if len(titled) == 1:
        return titled[0]
    if len(titled) > 1:
        raise ComfyWorkflowError(
            f'The preset "{preset}" has {len(titled)} nodes titled "{title}". '
            f"Only one node can be the {role}."
        )

    matched = [node_id for node_id, node in _nodes(prompt) if node["class_type"] in classes]
    if len(matched) == 1:
        return matched[0]

    if not matched:
        raise ComfyWorkflowError(
            f'The preset "{preset}" has no {role} node. '
            f'Title the node you want in ComfyUI "{title}" and re-export it.'
        )

    raise ComfyWorkflowError(
        f'The preset "{preset}" has {len(matched)} {role} nodes and none is titled "{title}". '
        f"Title the one to use and re-export it."
    )


def _optional_titled_node(prompt: dict[str, Any], title: str) -> str | None:
    titled = [node_id for node_id, node in _nodes(prompt) if _node_title(node) == title]
    return titled[0] if len(titled) == 1 else None


def _numeric_key(node: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    """The first key holding a number of its own. A linked input is a list and must not match."""
    inputs = _node_inputs(node)
    for key in keys:
        if isinstance(inputs.get(key), int | float):
            return key
    return None


def _seed_key(node: dict[str, Any]) -> str | None:
    return _numeric_key(node, _SEED_INPUT_KEYS)


def _input_widget_key(node: dict[str, Any]) -> str | None:
    inputs = _node_inputs(node)
    known = INPUT_KEYS.get(node["class_type"])
    if known is not None:
        return known if isinstance(inputs.get(known), str) else None
    for key in INPUT_WIDGET_KEYS:
        if isinstance(inputs.get(key), str):
            return key
    return None


def parse_comfy_workflow(raw: str, *, source: str) -> ComfyWorkflow:
    """Parse a preset and resolve its roles, or explain what is wrong with it."""
    if len(raw.encode("utf-8")) > MAX_WORKFLOW_BYTES:
        raise ComfyWorkflowError(f'The preset "{source}" is too large to be a workflow.')

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ComfyWorkflowError(f'The preset "{source}" is not valid JSON: {error}') from error

    if _is_editor_format(payload):
        raise ComfyWorkflowError(
            f'The preset "{source}" is an editor workflow, not an API-format one. {_EXPORT_HINT}'
        )

    if not isinstance(payload, dict) or not _nodes(payload):
        raise ComfyWorkflowError(f'The preset "{source}" holds no ComfyUI nodes. {_EXPORT_HINT}')

    for _, node in _nodes(payload):
        if node["class_type"] in PATH_LOADERS:
            raise ComfyWorkflowError(
                f'The preset "{source}" loads from a filesystem path. DataForge uploads the '
                "file instead, so title an upload loader such as VHS_LoadVideo."
            )
        if node["class_type"] == "VHS_BatchManager":
            raise ComfyWorkflowError(
                f'The preset "{source}" uses unsupported VHS batch-manager continuations. '
                "Remove the batch manager and process a shorter clip, or use a workflow "
                "that chunks frames within one prompt."
            )

    input_node = _resolve_role(
        source, payload, title=INPUT_NODE_TITLE, classes=INPUT_CLASSES, role="input"
    )
    output_node = _resolve_role(
        source, payload, title=OUTPUT_NODE_TITLE, classes=OUTPUT_CLASSES, role="output"
    )

    input_key = _input_widget_key(payload[input_node])
    if input_key is None:
        keys = " or ".join(repr(key) for key in INPUT_WIDGET_KEYS)
        raise ComfyWorkflowError(
            f'The input node of preset "{source}" takes no filename under {keys}. '
            f"Title a loading node {INPUT_NODE_TITLE!r} instead."
        )

    output_class = payload[output_node]["class_type"]
    if output_class not in _NO_PREFIX_CLASSES and "filename_prefix" not in _node_inputs(
        payload[output_node]
    ):
        raise ComfyWorkflowError(
            f'The output node of preset "{source}" takes no filename prefix. '
            f"Title a saving node {OUTPUT_NODE_TITLE!r} instead."
        )

    seed_node = _optional_titled_node(payload, SEED_NODE_TITLE)
    if seed_node is not None and _seed_key(payload[seed_node]) is None:
        raise ComfyWorkflowError(
            f'The node titled "{SEED_NODE_TITLE}" in preset "{source}" has no seed input.'
        )

    fps_node = _optional_titled_node(payload, FPS_NODE_TITLE)
    fps_key = _numeric_key(payload[fps_node], _FPS_INPUT_KEYS) if fps_node else None
    if fps_node is not None and fps_key is None:
        keys = ", ".join(repr(key) for key in _FPS_INPUT_KEYS)
        raise ComfyWorkflowError(
            f'The node titled "{FPS_NODE_TITLE}" in preset "{source}" has no frame rate to write. '
            f"Title a node holding its own number under one of {keys}, such as FloatConstant."
        )

    prompt_node = _optional_titled_node(payload, PROMPT_NODE_TITLE)
    # A linked text input is a list; writing over it would be dropped without a word.
    if prompt_node is not None and not isinstance(
        _node_inputs(payload[prompt_node]).get("text"), str
    ):
        raise ComfyWorkflowError(
            f'The node titled "{PROMPT_NODE_TITLE}" in preset "{source}" has no text input to '
            f"write. Title a node that holds its own prompt text, such as CLIPTextEncode."
        )

    return ComfyWorkflow(
        preset=source,
        prompt=payload,
        input_node=input_node,
        input_key=input_key,
        output_node=output_node,
        seed_nodes=(seed_node,) if seed_node else (),
        prompt_node=prompt_node,
        fps_node=fps_node,
        fps_key=fps_key,
    )


def _preset_path(name: str) -> Path:
    """Resolve a preset name to a file, refusing anything that is not a plain name."""
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise ComfyWorkflowError("Choose a workflow preset to run.")
    return get_comfy_workflows_dir() / f"{name}{WORKFLOW_EXTENSION}"


def list_comfy_presets() -> list[ComfyPreset]:
    """Every preset file, by name. Listing does not parse them."""
    folder = get_comfy_workflows_dir()
    presets: list[ComfyPreset] = []

    try:
        entries = sorted(folder.glob(f"*{WORKFLOW_EXTENSION}"))
    except OSError:
        return []

    for path in entries:
        try:
            stat = path.stat()
        except OSError:
            continue
        if not path.is_file():
            continue
        presets.append(ComfyPreset(name=path.stem, path=path, modified_at=stat.st_mtime))

    presets.sort(key=lambda preset: preset.name.lower())
    return presets


def read_comfy_preset_text(name: str) -> str:
    """The preset's raw JSON, for an editor or a diff."""
    path = _preset_path(name)
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise ComfyWorkflowError(f'No workflow preset named "{name}".') from error


def load_comfy_workflow(name: str) -> ComfyWorkflow:
    return parse_comfy_workflow(read_comfy_preset_text(name), source=name)


def build_comfy_prompt(
    workflow: ComfyWorkflow,
    *,
    media_ref: str,
    filename_prefix: str,
    seed: int | None = None,
    prompt_text: str | None = None,
    frame_rate: float | None = None,
) -> dict[str, Any]:
    """A run-ready copy of the graph with this file's values filled in."""
    prompt = deepcopy(workflow.prompt)

    prompt[workflow.input_node]["inputs"][workflow.input_key] = media_ref

    output_inputs = prompt[workflow.output_node].get("inputs")
    if isinstance(output_inputs, dict) and "filename_prefix" in output_inputs:
        output_inputs["filename_prefix"] = filename_prefix

    if seed is not None:
        for node_id in workflow.seed_nodes:
            key = _seed_key(prompt[node_id])
            if key is not None:
                prompt[node_id]["inputs"][key] = seed

    if frame_rate is not None and workflow.fps_node is not None and workflow.fps_key is not None:
        prompt[workflow.fps_node]["inputs"][workflow.fps_key] = frame_rate

    if prompt_text is not None and workflow.prompt_node is not None:
        node_inputs = prompt[workflow.prompt_node].get("inputs")
        if isinstance(node_inputs, dict) and isinstance(node_inputs.get("text"), str):
            node_inputs["text"] = prompt_text

    return prompt
