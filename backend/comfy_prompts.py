from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from comfy_metadata import read_media_metadata_values

_MAX_STRING_HOPS = 12
_MAX_PROMPT_CHARS = 20000

_COUNTER_SUFFIX = re.compile(r"^(?P<base>.+?)[_-]\d{2,}_?$")

_SAVE_CLASS_MARKERS = ("save", "videocombine", "output")
_PREVIEW_CLASS_MARKERS = ("preview",)

_POSITIVE_INPUT_NAMES = frozenset(
    {"text", "prompt", "positive", "positive_prompt", "text_g", "text_l", "caption", "string"}
)
_NEGATIVE_INPUT_NAMES = frozenset({"negative", "negative_prompt", "text_negative"})
_PROMPT_INPUT_NAMES = _POSITIVE_INPUT_NAMES | _NEGATIVE_INPUT_NAMES
_SLOT_INPUT_NAMES = frozenset({"positive", "positive_prompt"}) | _NEGATIVE_INPUT_NAMES

_STRING_PASSTHROUGH_INPUTS = ("value", "string", "text", "string_a", "text_a", "prompt")

_PARAMETER_LABELS: dict[str, str] = {
    "ckpt_name": "Checkpoint",
    "unet_name": "Model",
    "model_name": "Model",
    "vae_name": "VAE",
    "clip_name": "CLIP",
    "seed": "Seed",
    "noise_seed": "Seed",
    "steps": "Steps",
    "cfg": "CFG",
    "guidance": "Guidance",
    "denoise": "Denoise",
    "sampler_name": "Sampler",
    "scheduler": "Scheduler",
    "width": "Width",
    "height": "Height",
    "aspect_ratio": "Aspect ratio",
    "megapixels": "Megapixels",
    "length": "Frames",
    "frame_rate": "Frame rate",
}


@dataclass(frozen=True)
class PromptText:
    role: str
    text: str
    node_id: str
    node_title: str | None
    input_name: str


@dataclass(frozen=True)
class Parameter:
    label: str
    value: str


@dataclass
class OutputBranch:
    node_id: str
    class_type: str
    label: str
    filename_prefix: str | None
    is_preview: bool
    matches_filename: bool
    prompts: list[PromptText] = field(default_factory=list)
    parameters: list[Parameter] = field(default_factory=list)
    loras: list[str] = field(default_factory=list)


@dataclass
class WorkflowPrompts:
    has_workflow: bool
    source: str
    branches: list[OutputBranch]
    matched_node_id: str | None
    orphan_prompts: list[PromptText]


def _link_target(value: object) -> str | None:
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], (str, int)):
        return str(value[0])
    return None


def _node_inputs(node: object) -> dict[str, object]:
    if not isinstance(node, dict):
        return {}
    inputs = node.get("inputs")
    return inputs if isinstance(inputs, dict) else {}


def _node_class(node: object) -> str:
    if not isinstance(node, dict):
        return ""
    class_type = node.get("class_type")
    return class_type if isinstance(class_type, str) else ""


def _node_title(node: object) -> str | None:
    if not isinstance(node, dict):
        return None
    meta = node.get("_meta")
    if isinstance(meta, dict):
        title = meta.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    return None


def _build_consumers(graph: dict[str, dict]) -> dict[str, list[tuple[str, str]]]:
    consumers: dict[str, list[tuple[str, str]]] = {}
    for node_id, node in graph.items():
        for input_name, value in _node_inputs(node).items():
            source = _link_target(value)
            if source is not None:
                consumers.setdefault(source, []).append((node_id, input_name))
    return consumers


def _ancestors(graph: dict[str, dict], root: str) -> list[str]:
    seen = {root}
    order = [root]
    queue = [root]
    while queue:
        current = queue.pop(0)
        for value in _node_inputs(graph.get(current)).values():
            source = _link_target(value)
            if source is None or source in seen or source not in graph:
                continue
            seen.add(source)
            order.append(source)
            queue.append(source)
    return order


def _resolve_string(graph: dict[str, dict], node_id: str, hops: int = 0) -> tuple[str, str] | None:
    if hops >= _MAX_STRING_HOPS:
        return None
    node = graph.get(node_id)
    if node is None:
        return None

    inputs = _node_inputs(node)
    for candidate in _STRING_PASSTHROUGH_INPUTS:
        value = inputs.get(candidate)
        if isinstance(value, str) and value.strip():
            return node_id, value
        source = _link_target(value)
        if source is not None:
            resolved = _resolve_string(graph, source, hops + 1)
            if resolved is not None:
                return resolved

    return None


def _text_at(graph: dict[str, dict], node_id: str, value: object) -> tuple[str, str] | None:
    if isinstance(value, str):
        return (node_id, value) if value.strip() else None
    source = _link_target(value)
    return _resolve_string(graph, source) if source is not None else None


def _collect_prompts(graph: dict[str, dict], node_ids: list[str]) -> list[PromptText]:
    prompts: list[tuple[int, PromptText]] = []
    seen: set[str] = set()
    claimed: set[str] = set()
    distance = {node_id: index for index, node_id in enumerate(node_ids)}

    def add(reached_at: str, origin: str, text: str, role: str, input_name: str) -> None:
        if text.strip() in seen:
            return
        seen.add(text.strip())
        claimed.add(origin)
        node = graph.get(origin)
        prompts.append(
            (
                distance.get(reached_at, len(distance)),
                PromptText(
                    role=role,
                    text=text[:_MAX_PROMPT_CHARS],
                    node_id=origin,
                    node_title=_node_title(node) or _node_class(node),
                    input_name=input_name,
                ),
            )
        )

    # A CLIPTextEncode carries no polarity of its own; the sampler slot it lands in does.
    for node_id in node_ids:
        for input_name, value in _node_inputs(graph.get(node_id)).items():
            key = input_name.lower()
            if key not in _SLOT_INPUT_NAMES:
                continue
            found = _text_at(graph, node_id, value)
            if found is not None:
                role = "negative" if key in _NEGATIVE_INPUT_NAMES else "positive"
                add(node_id, *found, role, input_name)

    for node_id in node_ids:
        if node_id in claimed:
            continue
        for input_name, value in _node_inputs(graph.get(node_id)).items():
            key = input_name.lower()
            if key not in _PROMPT_INPUT_NAMES or key in _SLOT_INPUT_NAMES:
                continue
            found = _text_at(graph, node_id, value)
            if found is not None and found[0] not in claimed:
                role = "negative" if key in _NEGATIVE_INPUT_NAMES else "positive"
                add(node_id, *found, role, input_name)

    # Nearest the output first: the last stage to touch the pixels is the one being looked at.
    prompts.sort(key=lambda entry: (entry[0], entry[1].role == "negative"))
    return [prompt for _, prompt in prompts]


def _lora_names(value: object) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, dict):
        if value.get("on") is False:
            return []
        name = value.get("lora")
        if isinstance(name, str) and name.strip():
            strength = value.get("strength")
            if isinstance(strength, (int, float)) and strength != 1:
                return [f"{name.strip()} ({strength})"]
            return [name.strip()]
    return []


def _collect_parameters(
    graph: dict[str, dict], node_ids: list[str]
) -> tuple[list[Parameter], list[str]]:
    parameters: list[Parameter] = []
    loras: list[str] = []
    seen: set[tuple[str, str]] = set()

    for node_id in node_ids:
        for input_name, value in _node_inputs(graph.get(node_id)).items():
            if input_name.startswith("lora"):
                for name in _lora_names(value):
                    if name not in loras:
                        loras.append(name)
                continue

            label = _PARAMETER_LABELS.get(input_name)
            if label is None or isinstance(value, (list, dict)):
                continue

            rendered = str(value)
            marker = (label, rendered)
            if marker in seen:
                continue
            seen.add(marker)
            parameters.append(Parameter(label=label, value=rendered))

    return parameters, loras


def _filename_prefix(node: object) -> str | None:
    value = _node_inputs(node).get("filename_prefix")
    return value if isinstance(value, str) and value.strip() else None


def _prefix_basename(prefix: str) -> str:
    return re.split(r"[\\/]", prefix.strip())[-1].strip()


def _file_stem_base(file_path: Path) -> str:
    stem = file_path.stem
    match = _COUNTER_SUFFIX.match(stem)
    return match.group("base") if match else stem


def _matches_filename(prefix: str | None, file_base: str) -> bool:
    if not prefix:
        return False
    basename = _prefix_basename(prefix)
    return bool(basename) and basename.lower() == file_base.lower()


def _is_output_node(node: object, node_id: str, consumers: dict[str, list]) -> bool:
    lowered = _node_class(node).lower()
    if any(marker in lowered for marker in _SAVE_CLASS_MARKERS + _PREVIEW_CLASS_MARKERS):
        return True
    if node_id in consumers:
        return False
    return any(_link_target(value) is not None for value in _node_inputs(node).values())


def _instance_id(node_id: str) -> str:
    return node_id.split(":", 1)[0]


def _subgraph_labels(workflow: object) -> dict[str, str]:
    if not isinstance(workflow, dict):
        return {}

    definitions = workflow.get("definitions")
    subgraphs = definitions.get("subgraphs") if isinstance(definitions, dict) else None
    if not isinstance(subgraphs, list):
        return {}

    names: dict[str, str] = {}
    for definition in subgraphs:
        if not isinstance(definition, dict):
            continue
        identifier = definition.get("id")
        name = definition.get("name")
        if isinstance(identifier, str) and isinstance(name, str) and name.strip():
            names[identifier] = name.strip()

    labels: dict[str, str] = {}
    nodes = workflow.get("nodes")
    for node in nodes if isinstance(nodes, list) else []:
        if not isinstance(node, dict):
            continue
        title = node.get("title")
        label = title if isinstance(title, str) and title.strip() else names.get(node.get("type"))
        if label:
            labels[str(node.get("id"))] = label.strip()

    return labels


def _branch_label(node: object, ancestry: list[str], subgraph_labels: dict[str, str]) -> str:
    group = next(
        (
            label
            for label in (subgraph_labels.get(_instance_id(step)) for step in ancestry)
            if label
        ),
        None,
    )
    return group or _node_title(node) or _node_class(node) or "Output"


def _parse_graph(raw: str) -> dict[str, dict] | None:
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    graph = {
        str(key): value
        for key, value in parsed.items()
        if isinstance(value, dict) and "class_type" in value
    }
    return graph or None


def _parse_workflow(raw: str) -> dict | None:
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _sort_branches(branches: list[OutputBranch]) -> list[OutputBranch]:
    return sorted(
        branches,
        key=lambda branch: (
            not branch.matches_filename,
            branch.is_preview,
            not branch.prompts,
            branch.node_id,
        ),
    )


def _empty(has_workflow: bool = False, source: str = "none") -> WorkflowPrompts:
    return WorkflowPrompts(
        has_workflow=has_workflow,
        source=source,
        branches=[],
        matched_node_id=None,
        orphan_prompts=[],
    )


def extract_workflow_prompts(file_path: Path) -> WorkflowPrompts:
    values = read_media_metadata_values(file_path)
    if not values:
        return _empty()

    graph = None
    for key in ("prompt", "Prompt", "PROMPT"):
        graph = _parse_graph(values.get(key, ""))
        if graph:
            break

    workflow = None
    for key in ("workflow", "Workflow", "WORKFLOW"):
        workflow = _parse_workflow(values.get(key, ""))
        if workflow:
            break

    if graph is None:
        return _empty(has_workflow=False, source="none")

    consumers = _build_consumers(graph)
    subgraph_labels = _subgraph_labels(workflow)
    file_base = _file_stem_base(file_path)

    branches: list[OutputBranch] = []
    covered: set[str] = set()

    for node_id, node in graph.items():
        class_type = _node_class(node)
        if not _is_output_node(node, node_id, consumers):
            continue

        ancestry = _ancestors(graph, node_id)
        covered.update(ancestry)
        prefix = _filename_prefix(node)
        parameters, loras = _collect_parameters(graph, ancestry)

        branches.append(
            OutputBranch(
                node_id=node_id,
                class_type=class_type,
                label=_branch_label(node, ancestry, subgraph_labels),
                filename_prefix=prefix,
                is_preview=any(marker in class_type.lower() for marker in _PREVIEW_CLASS_MARKERS),
                matches_filename=_matches_filename(prefix, file_base),
                prompts=_collect_prompts(graph, ancestry),
                parameters=parameters,
                loras=loras,
            )
        )

    matched = [branch.node_id for branch in branches if branch.matches_filename]
    orphans = _collect_prompts(graph, [node_id for node_id in graph if node_id not in covered])

    return WorkflowPrompts(
        has_workflow=True,
        source="prompt",
        branches=_sort_branches(branches),
        matched_node_id=matched[0] if len(matched) == 1 else None,
        orphan_prompts=orphans,
    )
