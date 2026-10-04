from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from comfy_metadata import read_media_metadata_values
from schemas import ComfyPromptRole

_MAX_VALUE_HOPS = 12
_MAX_PROMPT_CHARS = 20000

_SAVE_CLASS_MARKERS = ("save", "videocombine", "output")
_PREVIEW_CLASS_MARKERS = ("preview",)
#: Lowercased classes that write their own file but carry no save marker in the name.
_EXTRA_OUTPUT_CLASSES = frozenset({"swiftvrrestorevideo"})

_POSITIVE_INPUT_NAMES = frozenset(
    {"text", "prompt", "positive", "positive_prompt", "text_g", "text_l", "caption", "string"}
)
_NEGATIVE_INPUT_NAMES = frozenset({"negative", "negative_prompt", "text_negative"})
_PROMPT_INPUT_NAMES = _POSITIVE_INPUT_NAMES | _NEGATIVE_INPUT_NAMES
_SLOT_INPUT_NAMES = frozenset({"positive", "positive_prompt"}) | _NEGATIVE_INPUT_NAMES

_STRING_PASSTHROUGH_INPUTS = ("_source", "value", "string", "text", "string_a", "text_a", "prompt")

_SCALAR_INPUT_KEYS = {
    "PrimitiveInt": "value",
    "PrimitiveFloat": "value",
    "PrimitiveBoolean": "value",
    "PrimitiveString": "value",
    "PrimitiveStringMultiline": "value",
    "INTConstant": "value",
    "FloatConstant": "value",
    "BOOLConstant": "value",
    "StringConstant": "string",
}

_ROUTE_CLASSES = frozenset({"GetNode", "SetNode", "Reroute"})
#: Impact Pack detailers and Ultimate SD Upscale re-sample the image their own stage made.
_REFINER_CLASS_MARKERS = ("detailer", "ultimatesdupscale")
_NAME_INPUT_KEYS = ("filename_prefix", "filename")

type ScalarValue = str | int | float | bool

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
    role: ComfyPromptRole
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
    filename: str | None
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


def _link_reference(value: object) -> tuple[str, int] | None:
    if (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], (str, int))
        and isinstance(value[1], int)
        and not isinstance(value[1], bool)
        and value[1] >= 0
    ):
        return str(value[0]), value[1]
    return None


def _link_target(value: object) -> str | None:
    reference = _link_reference(value)
    return reference[0] if reference else None


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


def _generation_stages(graph: dict[str, dict]) -> tuple[set[str], set[str], set[str]]:
    """Samplers, generators, and the nodes that only carry an earlier sampler's result on.

    A generator is a sampler or a node carrying its own prompt, such as an image-to-video node,
    but never a refiner.
    A node computed from a sampler's result stays live if it also takes another computed input,
    such as a node mixing a first pass's latent into the second pass's conditioning.
    """
    samplers = {
        node_id
        for node_id, node in graph.items()
        if "latent_image" in _node_inputs(node) or _node_class(node).lower().endswith("sampler")
    }
    generators = samplers | {
        node_id
        for node_id, node in graph.items()
        if any(
            key.lower() in _PROMPT_INPUT_NAMES and _text_at(graph, node_id, value) is not None
            for key, value in _node_inputs(node).items()
        )
    }
    # A save node with a caption input writes text; it generates nothing.
    generators -= {
        node_id
        for node_id in generators
        if _is_output_node(graph[node_id])
        or any(marker in _node_class(graph[node_id]).lower() for marker in _REFINER_CLASS_MARKERS)
    }

    sources: dict[str, set[str]] = {
        node_id: {
            source
            for value in _node_inputs(node).values()
            if (source := _link_target(value)) is not None and source in graph
        }
        for node_id, node in graph.items()
    }
    consumers: dict[str, list[str]] = {}
    for node_id, linked in sources.items():
        for source in linked:
            consumers.setdefault(source, []).append(node_id)
    sampled = set(samplers)
    queue = list(samplers)
    while queue:
        for consumer in consumers.get(queue.pop(), []):
            if consumer not in sampled:
                sampled.add(consumer)
                queue.append(consumer)

    results = {
        node_id
        for node_id in sampled - generators
        if all(source in sampled or not sources[source] for source in sources[node_id])
    }
    return samplers, generators, results


def _stage_ancestors(
    graph: dict[str, dict], root: str, stages: tuple[set[str], set[str], set[str]]
) -> list[str]:
    """Ancestors up to the nearest generation stage, excluding earlier stages' results.

    Past a generator, another sampler or an earlier result (an upstream image, a first pass's
    latent) is provenance rather than this output's settings. Nodes the stage reaches directly,
    such as a prompt shared with an earlier stage, still count.
    """
    samplers, generators, results = stages
    order = [root]
    visited = {(root, False)}
    queue = [(root, False)]
    while queue:
        current, crossed = queue.pop(0)
        crossed = crossed or current in generators
        for value in _node_inputs(graph.get(current)).values():
            source = _link_target(value)
            if source is None or source not in graph:
                continue
            if crossed and (source in samplers or source in results):
                continue
            # An uncrossed visit explores everything a crossed one would.
            if (source, crossed) in visited or (source, False) in visited:
                continue
            if (source, True) not in visited:
                order.append(source)
            visited.add((source, crossed))
            queue.append((source, crossed))
    return order


def _with_virtual_routes(graph: dict[str, dict], workflow: object) -> dict[str, dict]:
    if not isinstance(workflow, dict):
        return graph
    definitions = workflow.get("definitions")
    subgraphs = definitions.get("subgraphs", []) if isinstance(definitions, dict) else []
    definitions_by_id = {
        entry["id"]: entry
        for entry in (subgraphs if isinstance(subgraphs, list) else [])
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    resolved = graph.copy()

    def visit(scope: dict, prefix: str, inherited: dict[str, list], depth: int) -> None:
        if depth >= _MAX_VALUE_HOPS:
            return
        nodes = scope.get("nodes", [])
        nodes = (
            [node for node in nodes if isinstance(node, dict)] if isinstance(nodes, list) else []
        )
        links = scope.get("links", [])
        sources: dict[str, list] = {}
        for link in links if isinstance(links, list) else []:
            if isinstance(link, list) and len(link) >= 5:
                link_id, origin, slot = link[:3]
            elif isinstance(link, dict):
                link_id, origin, slot = (
                    link.get("id"),
                    link.get("origin_id"),
                    link.get("origin_slot"),
                )
            else:
                continue
            if isinstance(origin, (str, int)) and _link_reference([origin, slot]):
                sources[str(link_id)] = [f"{prefix}{origin}", slot]

        local: dict[str, list] = {}
        routes: dict[str, list] = {}
        for node in nodes:
            if node.get("type") != "SetNode":
                continue
            widgets = node.get("widgets_values")
            if not isinstance(widgets, list) or not widgets or not isinstance(widgets[0], str):
                continue
            inputs = node.get("inputs")
            source = None
            if isinstance(inputs, list) and inputs and isinstance(inputs[0], dict):
                source = sources.get(str(inputs[0].get("link")))
            local.setdefault(widgets[0], []).append(source)
            if source is not None:
                routes[str(node.get("id"))] = source

        setters = {**inherited, **local}
        for node in nodes:
            node_type = node.get("type")
            node_id = str(node.get("id"))
            if node_type == "GetNode":
                widgets = node.get("widgets_values")
                name = widgets[0] if isinstance(widgets, list) and widgets else None
                candidates = setters.get(name, []) if isinstance(name, str) and name else []
                if len(candidates) == 1 and candidates[0] is not None:
                    routes[node_id] = candidates[0]
            if node_id in routes:
                identifier = f"{prefix}{node_id}"
                existing = graph.get(identifier)
                # Executed API nodes win; editor metadata only supplies missing virtual routing.
                if existing is None or _node_class(existing) == node_type:
                    resolved[identifier] = {
                        **(existing or {}),
                        "class_type": node_type,
                        "inputs": {"_source": routes[node_id], **_node_inputs(existing)},
                    }
            definition = definitions_by_id.get(node_type) if isinstance(node_type, str) else None
            child_prefix = f"{prefix}{node_id}:"
            if definition and any(identifier.startswith(child_prefix) for identifier in graph):
                visit(definition, child_prefix, setters, depth + 1)

    visit(workflow, "", {}, 0)
    return resolved


def _forwarded_input(node: object) -> object | None:
    """The input a constant or route node passes on unchanged, or None for any other node."""
    inputs = _node_inputs(node)
    class_type = _node_class(node)
    key = _SCALAR_INPUT_KEYS.get(class_type)
    if key is not None:
        return inputs.get(key)
    if class_type in _ROUTE_CLASSES:
        if "_source" in inputs:
            return inputs["_source"]
        if class_type == "Reroute" and len(inputs) == 1:
            return next(iter(inputs.values()))
    return None


def _scalar_at(graph: dict[str, dict], value: object, hops: int = 0) -> ScalarValue | None:
    if isinstance(value, (str, int, float, bool)):
        return value
    reference = _link_reference(value)
    if reference is None or reference[1] != 0 or hops >= _MAX_VALUE_HOPS:
        return None
    node = graph.get(reference[0])
    resolved = _scalar_at(graph, _forwarded_input(node), hops + 1)
    if _node_class(node) == "FloatConstant" and isinstance(resolved, (int, float)):
        return round(resolved, 6)
    return resolved


def _scalar_chain(graph: dict[str, dict], value: object) -> list[str]:
    """The node ids `_scalar_at` walks through, so the constants it reads are not prompts."""
    chain: list[str] = []
    for _ in range(_MAX_VALUE_HOPS):
        reference = _link_reference(value)
        if reference is None or reference[1] != 0:
            break
        chain.append(reference[0])
        value = _forwarded_input(graph.get(reference[0]))
    return chain


def _resolve_string(graph: dict[str, dict], node_id: str, hops: int = 0) -> tuple[str, str] | None:
    if hops >= _MAX_VALUE_HOPS:
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
    value_sources = {
        source
        for node_id in node_ids
        for key, value in _node_inputs(graph.get(node_id)).items()
        if key in _PARAMETER_LABELS or key in _NAME_INPUT_KEYS
        for source in _scalar_chain(graph, value)
    }

    def add(
        reached_at: str, origin: str, text: str, role: ComfyPromptRole, input_name: str
    ) -> None:
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
        if node_id in claimed or (
            node_id in value_sources and _node_class(graph.get(node_id)) in _SCALAR_INPUT_KEYS
        ):
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


def _strength(graph: dict[str, dict], value: object) -> str | None:
    """A strength as a decimal (`1.0`, never `1`), so every loader's strengths read alike."""
    resolved = _scalar_at(graph, value)
    if isinstance(resolved, bool) or not isinstance(resolved, (int, float)):
        return None
    return str(float(round(resolved, 4)))


def _lora_names(graph: dict[str, dict], inputs: dict[str, object], value: object) -> list[str]:
    name = _scalar_at(graph, value)
    if isinstance(name, str) and name.strip():
        model = _strength(graph, inputs.get("strength_model"))
        clip = _strength(graph, inputs.get("strength_clip"))
        if clip is not None and clip != model:
            shown = f"{model}, clip {clip}" if model is not None else f"clip {clip}"
            return [f"{name.strip()} ({shown})"]
        return [f"{name.strip()} ({model})" if model is not None else name.strip()]
    if isinstance(value, dict):
        if value.get("on") is False:
            return []
        name = value.get("lora")
        if isinstance(name, str) and name.strip():
            strength = _strength(graph, value.get("strength"))
            return [f"{name.strip()} ({strength})" if strength is not None else name.strip()]
    return []


def _collect_parameters(
    graph: dict[str, dict], node_ids: list[str]
) -> tuple[list[Parameter], list[str]]:
    parameters: list[Parameter] = []
    loras: list[str] = []
    seen: set[tuple[str, str]] = set()

    for node_id in node_ids:
        inputs = _node_inputs(graph.get(node_id))
        for input_name, value in inputs.items():
            if input_name.startswith("lora"):
                for name in _lora_names(graph, inputs, value):
                    if name not in loras:
                        loras.append(name)
                continue

            label = _PARAMETER_LABELS.get(input_name)
            if label is None:
                continue
            resolved_value = _scalar_at(graph, value)
            if resolved_value is None:
                continue

            rendered = str(resolved_value)
            marker = (label, rendered)
            if marker in seen:
                continue
            seen.add(marker)
            parameters.append(Parameter(label=label, value=rendered))

    return parameters, loras


def _declared_name(graph: dict[str, dict], node: object, key: str) -> str | None:
    value = _scalar_at(graph, _node_inputs(node).get(key))
    return value if isinstance(value, str) and value.strip() else None


def _prefix_basename(prefix: str) -> str:
    return re.split(r"[\\/]", prefix.strip())[-1].strip()


def _matches_filename(
    prefix: str | None, filename: str | None, file_path: Path, class_type: str
) -> bool:
    # Embedded naming templates are not the evaluated names used when the nodes ran.
    if (
        filename
        and not re.search(r"%[^%]+%", filename)
        and _prefix_basename(filename).casefold() == file_path.name.casefold()
    ):
        return True
    if not prefix or re.search(r"%[^%]+%", prefix):
        return False
    basename = _prefix_basename(prefix)
    if not basename:
        return False
    if basename.casefold() == file_path.stem.casefold():
        return True
    suffix = r"[_-]\d{2,}_?"
    if class_type == "VHS_VideoCombine" and file_path.suffix.lower() in {".mp4", ".mov", ".m4v"}:
        suffix = r"(?:[_-]\d{2,}_?|_\d{2,}-audio)"
    return re.fullmatch(re.escape(basename) + suffix, file_path.stem, re.IGNORECASE) is not None


def _is_output_node(node: object) -> bool:
    """Named by class, not by having no consumer: a graph is full of dead ends that write nothing."""
    lowered = _node_class(node).lower()
    return lowered in _EXTRA_OUTPUT_CLASSES or any(
        marker in lowered for marker in _SAVE_CLASS_MARKERS + _PREVIEW_CLASS_MARKERS
    )


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


#: Where a payload hides when the container has no per-key metadata of its own.
_NESTED_KEYS = ("prompt", "Prompt", "PROMPT", "workflow", "Workflow", "WORKFLOW")


def _nested_values(values: dict[str, str]) -> dict[str, str]:
    """A muxed video writes the whole payload into one comment, so unwrap a level before reading.

    ``prompt`` arrives as a JSON string and ``workflow`` as an object; both come back as text.
    """
    nested: dict[str, str] = {}

    for raw in values.values():
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(parsed, dict):
            continue

        for key in _NESTED_KEYS:
            if key in nested or key not in parsed:
                continue
            value = parsed[key]
            nested[key] = value if isinstance(value, str) else json.dumps(value)

    return nested


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


def _empty() -> WorkflowPrompts:
    return WorkflowPrompts(
        has_workflow=False,
        source="none",
        branches=[],
        matched_node_id=None,
        orphan_prompts=[],
    )


def extract_workflow_prompts(file_path: Path) -> WorkflowPrompts:
    values = read_media_metadata_values(file_path)
    if not values:
        return _empty()

    # Top level wins: a PNG names its chunks, and only a container that cannot needs unwrapping.
    values = {**_nested_values(values), **values}

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
        return _empty()

    subgraph_labels = _subgraph_labels(workflow)
    graph = _with_virtual_routes(graph, workflow)

    branches: list[OutputBranch] = []
    covered: set[str] = set()
    stages = _generation_stages(graph)

    for node_id, node in graph.items():
        class_type = _node_class(node)
        if not _is_output_node(node):
            continue

        # Earlier stages are excluded from the branch but still feed it, so they are no orphans.
        covered.update(_ancestors(graph, node_id))
        ancestry = _stage_ancestors(graph, node_id, stages)
        prefix = _declared_name(graph, node, "filename_prefix")
        filename = _declared_name(graph, node, "filename")
        parameters, loras = _collect_parameters(graph, ancestry)

        branches.append(
            OutputBranch(
                node_id=node_id,
                class_type=class_type,
                label=_branch_label(node, ancestry, subgraph_labels),
                filename_prefix=prefix,
                filename=filename,
                is_preview=any(marker in class_type.lower() for marker in _PREVIEW_CLASS_MARKERS),
                matches_filename=_matches_filename(prefix, filename, file_path, class_type),
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
