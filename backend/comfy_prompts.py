from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from comfy_computed import math_expression, math_expression_output, resolution_selector
from comfy_editor_graph import EditorNode, flatten_editor_graph
from comfy_metadata import read_media_metadata_values
from media_dimensions import media_dimensions
from schemas import ComfyMapNodeKind, ComfyMediaKind, ComfyPassStatus, ComfyPromptRole

_MAX_VALUE_HOPS = 12
_MAX_PROMPT_CHARS = 20000

_SAVE_CLASS_MARKERS = ("save", "videocombine", "output")
_PREVIEW_CLASS_MARKERS = ("preview",)
_MEDIA_INPUTS = frozenset({"images", "image", "video", "audio"})
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
_RESOLUTION_INPUT_KEYS = ("aspect_ratio", "megapixels", "multiple")
#: Impact Pack detailers and Ultimate SD Upscale re-sample the image their own stage made.
_REFINER_CLASS_MARKERS = ("detailer", "ultimatesdupscale")
_NAME_INPUT_KEYS = ("filename_prefix", "filename")
#: Switched off, Video Helper Suite's combine writes to ComfyUI's temp folder, as a preview does.
_SAVE_FLAG_INPUTS = ("save_output",)
#: Lazy switches by their selector and the input each value evaluates; the rest never run.
_BOOLEAN_SWITCHES = {
    "ComfySwitchNode": ("switch", "on_true", "on_false"),
    "ImpactConditionalBranch": ("cond", "tt_value", "ff_value"),
}
#: Impact Pack's indexed switches evaluate only `input{select}`.
_INDEXED_SWITCHES = frozenset({"ImpactSwitch", "LatentSwitch", "SEGSSwitch"})
_INDEXED_INPUT = re.compile(r"input\d+")

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


@dataclass(frozen=True)
class SamplingStage:
    node_id: str
    label: str
    #: The innermost subgraph the pass sits in.
    group: str | None
    status: ComfyPassStatus
    parameters: list[Parameter]
    loras: list[str]


@dataclass(frozen=True)
class MapNode:
    """One box of the output's map: a pass, or what feeds the passes."""

    id: str
    kind: ComfyMapNodeKind
    label: str
    #: The full text behind a short label: a prompt, a model file or LoRA names.
    detail: list[str]
    status: ComfyPassStatus
    #: Map nodes this one hands its result to directly.
    feeds: list[str]
    role: ComfyPromptRole | None = None
    #: Set on an input box: what kind of media it is.
    media: ComfyMediaKind | None = None
    #: Set on an input an earlier stage generated: that stage's name.
    source: str | None = None


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
    #: With `stages`, only the settings no single pass owns; otherwise every setting.
    parameters: list[Parameter] = field(default_factory=list)
    loras: list[str] = field(default_factory=list)
    #: Sampling passes, earliest first; empty when the output has one pass and it ran.
    stages: list[SamplingStage] = field(default_factory=list)
    #: The passes and what feeds them, earliest first; empty when nothing samples.
    map: list[MapNode] = field(default_factory=list)
    #: Widths and heights the stage was set to render at, for telling same-named outputs apart.
    widths: frozenset[int] = frozenset()
    heights: frozenset[int] = frozenset()


@dataclass
class WorkflowPrompts:
    has_workflow: bool
    source: str
    branches: list[OutputBranch]
    matched_node_id: str | None
    orphan_prompts: list[PromptText]
    has_editor_workflow: bool = False
    #: The filename matched several outputs, and only the matched one renders at the file's size.
    matched_by_size: bool = False


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


def _generation_stages(
    graph: dict[str, dict], outputs: set[str]
) -> tuple[set[str], set[str], set[str]]:
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
        if node_id in outputs
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


def _skipped_inputs(graph: dict[str, dict], node: object) -> set[str]:
    """The inputs a lazy switch never evaluates; none when its selector cannot be read."""
    inputs = _node_inputs(node)
    class_type = _node_class(node)
    if class_type in _BOOLEAN_SWITCHES:
        selector, when_true, when_false = _BOOLEAN_SWITCHES[class_type]
        chosen = _scalar_at(graph, inputs.get(selector))
        if isinstance(chosen, bool):
            return {when_false if chosen else when_true}
    elif class_type in _INDEXED_SWITCHES:
        chosen = _scalar_at(graph, inputs.get("select"))
        if isinstance(chosen, int) and not isinstance(chosen, bool):
            return {
                key for key in inputs if _INDEXED_INPUT.fullmatch(key) and key != f"input{chosen}"
            }
    return set()


def _live_nodes(graph: dict[str, dict], root: str) -> set[str]:
    """Ancestors that ran: everything reachable without passing a switch's unselected input."""
    live = {root}
    queue = [root]
    while queue:
        node = graph.get(queue.pop())
        skipped = _skipped_inputs(graph, node)
        for key, value in _node_inputs(node).items():
            source = _link_target(value)
            if key in skipped or source is None or source in live or source not in graph:
                continue
            live.add(source)
            queue.append(source)
    return live


def _is_sampling_node(node: object) -> bool:
    """Whether a node runs its own sampling pass; refiners and upscalers included."""
    lowered = _node_class(node).lower()
    keys = _node_inputs(node).keys()
    return (
        "latent_image" in keys
        or lowered.endswith("sampler")
        or any(marker in lowered for marker in _REFINER_CLASS_MARKERS)
        or {"sampler", "sigmas"} <= keys
        or {"steps", "sampler_name"} <= keys
    )


def _stand_in(entry: EditorNode) -> dict:
    """An API-format node for a bypassed editor node, so its settings read like any other's."""
    inputs: dict[str, object] = {**entry.widgets, **entry.values}
    inputs.update({name: [source, slot] for name, (source, slot) in entry.links.items()})
    return {
        "class_type": entry.class_type,
        "inputs": inputs,
        "_meta": {"title": entry.title} if entry.title else {},
    }


def _linked_inputs(
    graph: dict[str, dict], editor: dict[str, EditorNode], node_id: str
) -> list[tuple[str, str]]:
    """``(input name, source)`` for what feeds a node in either graph.

    Both, because the prompt links around a bypassed node that the editor still has.
    """
    linked = [
        (name, source)
        for name, value in _node_inputs(graph.get(node_id)).items()
        if (source := _link_target(value)) is not None
    ]
    entry = editor.get(node_id)
    return (
        linked + [(name, source) for name, (source, _) in entry.links.items()] if entry else linked
    )


def _sources(graph: dict[str, dict], editor: dict[str, EditorNode], node_id: str) -> list[str]:
    return [source for _, source in _linked_inputs(graph, editor, node_id)]


def _bypassed_on_path(
    graph: dict[str, dict], editor: dict[str, EditorNode], root: str, members: set[str]
) -> list[str]:
    """Bypassed editor nodes the output's own stage runs through, nearest first.

    The walk crosses only the branch's own nodes, so an earlier stage's bypassed nodes are left
    to the output that stage feeds.
    """
    found: list[str] = []
    seen = {root}
    queue = [root]
    while queue:
        for source in _sources(graph, editor, queue.pop(0)):
            if source in seen:
                continue
            entry = editor.get(source)
            if entry is not None and entry.bypassed:
                found.append(source)
            elif source not in members:
                continue
            seen.add(source)
            queue.append(source)
    return found


def _pass_region(
    graph: dict[str, dict], stage: str, members: set[str], stage_ids: set[str]
) -> set[str]:
    """What a pass reads within the branch, up to but excluding any other pass."""
    region = {stage}
    queue = [stage]
    while queue:
        for value in _node_inputs(graph.get(queue.pop())).values():
            source = _link_target(value)
            if source in members and source not in region and source not in stage_ids:
                region.add(source)
                queue.append(source)
    return region


def _earliest_first(ids: list[str], reads: dict[str, set[str]]) -> list[str]:
    """``ids`` reordered so each comes after what it reads; ties keep the given order."""
    ordered: list[str] = []
    while len(ordered) < len(ids):
        placed = set(ordered)
        waiting = [node_id for node_id in ids if node_id not in placed]
        ordered.append(
            next((node_id for node_id in waiting if reads[node_id] <= placed), waiting[0])
        )
    return ordered


def _pass_status(stage: str, live: set[str], bypassed: set[str]) -> ComfyPassStatus:
    if stage in bypassed:
        return "bypassed"
    return "ran" if stage in live else "switched_off"


def _split_by_pass(
    graph: dict[str, dict],
    ancestry: list[str],
    bypassed: list[str],
    live: set[str],
    editor: dict[str, EditorNode],
    subgraph_labels: dict[str, str],
) -> tuple[list[str], list[SamplingStage]]:
    """The branch's shared nodes, and its passes with the nodes only each of them reads.

    ``graph`` carries stand-ins for the ``bypassed`` nodes. A node that ran belongs to a pass
    only if no other pass reads it and that pass ran too; what a pass that did not run alone
    reads is shown on it. Anything else that never ran is dropped. A single pass that ran
    keeps every node on the branch.
    """
    members = ancestry + bypassed
    stage_ids = [step for step in members if _is_sampling_node(graph.get(step))]
    if len(stage_ids) < 2 and all(stage in live for stage in stage_ids):
        return [step for step in ancestry if step in live], []

    member_set = set(members)
    stage_set = set(stage_ids)
    holders: dict[str, list[str]] = {}
    for stage in stage_ids:
        for step in _pass_region(graph, stage, member_set, stage_set):
            holders.setdefault(step, []).append(stage)

    def owner(step: str) -> str | None:
        found = holders.get(step, [])
        if len(found) == 1 and (found[0] in live) == (step in live):
            return found[0]
        return None

    def nearest_passes(target: str) -> set[str]:
        """The passes a node reads with no other pass in between.

        Not bounded by the branch: the latent between two passes is an earlier result the
        branch leaves out.
        """
        found: set[str] = set()
        seen = {target}
        queue = [target]
        while queue:
            for source in _sources(graph, editor, queue.pop()):
                if source in seen:
                    continue
                seen.add(source)
                if source in stage_set:
                    found.add(source)
                else:
                    queue.append(source)
        return found

    bypassed_set = set(bypassed)
    reads = {stage: nearest_passes(stage) for stage in stage_ids}
    stages: list[SamplingStage] = []
    for stage in _earliest_first(stage_ids, reads):
        parameters, loras = _collect_parameters(
            graph, [step for step in members if owner(step) == stage]
        )
        instance = stage.rpartition(":")[0]
        stages.append(
            SamplingStage(
                node_id=stage,
                label=_node_title(graph[stage]) or _node_class(graph[stage]),
                group=subgraph_labels.get(instance) if instance else None,
                status=_pass_status(stage, live, bypassed_set),
                parameters=parameters,
                loras=loras,
            )
        )
    shared = [step for step in ancestry if step in live and owner(step) is None]
    return shared, stages


_MODEL_FILE_KEYS = ("ckpt_name", "unet_name")
_INPUT_MEDIA_KEYS: tuple[ComfyMediaKind, ...] = ("image", "video", "audio")
#: Within a row of the map, sources read left to right in this order.
_MAP_KIND_ORDER: dict[ComfyMapNodeKind, int] = {
    "model": 0,
    "loras": 1,
    "input": 2,
    "prompt": 3,
    "pass": 4,
    "output": 5,
}


def _short_name(path: str) -> str:
    """A file name without its folders and extension, for a box too small for the path."""
    name = re.split(r"[\\/]", path.strip())[-1]
    return name.rsplit(".", 1)[0] if "." in name else name


def _map_box(
    graph: dict[str, dict], node_id: str
) -> tuple[ComfyMapNodeKind, str, list[str]] | None:
    """The kind, label and detail of a node the map shows, or None for one it walks through."""
    node = graph.get(node_id)
    if _is_sampling_node(node):
        return "pass", _node_title(node) or _node_class(node), []
    inputs = _node_inputs(node)
    for key in _MODEL_FILE_KEYS:
        model = _scalar_at(graph, inputs.get(key))
        if isinstance(model, str) and model.strip():
            return "model", _short_name(model), [model.strip()]
    _, loras = _collect_parameters(graph, [node_id])
    if loras:
        return "loras", "", loras
    if "load" in _node_class(node).lower() and (media := _loaded_media(node)):
        file = str(inputs[media]).strip()
        return "input", _short_name(file), [file]
    return None


def _loaded_media(node: object) -> ComfyMediaKind | None:
    """The kind of media file a node names, by the input that holds it."""
    inputs = _node_inputs(node)
    return next(
        (
            key
            for key in _INPUT_MEDIA_KEYS
            if isinstance(value := inputs.get(key), str) and value.strip()
        ),
        None,
    )


def _media_of(input_name: str) -> ComfyMediaKind | None:
    """What an input that takes another stage's result carries, judged by its name.

    None for a latent: one sampler handing its latent to the next, as a high-noise pass does
    to its low-noise one, is a chain of passes, not media coming in.
    """
    lowered = input_name.lower()
    if "latent" in lowered or lowered == "samples":
        return None
    return "audio" if "audio" in lowered else "video" if "video" in lowered else "image"


def _is_earlier_result(
    graph: dict[str, dict], editor: dict[str, EditorNode], node_id: str, members: set[str]
) -> bool:
    """Whether a node outside the branch carries an earlier stage's result into it.

    Upstream of it a sampler runs, and none of the branch's own passes does; that tells a
    reference image apart from the latent handed between two passes of the branch itself.
    """
    samples = _is_sampling_node(graph.get(node_id))
    seen = {node_id}
    queue = [node_id]
    while queue:
        for source in _sources(graph, editor, queue.pop()):
            if source in seen:
                continue
            seen.add(source)
            if source in members:
                if _is_sampling_node(graph.get(source)):
                    return False
                continue
            samples = samples or _is_sampling_node(graph.get(source))
            queue.append(source)
    return samples


def _prompt_box_id(prompt: PromptText) -> str:
    return f"prompt:{prompt.node_id}:{prompt.input_name}"


def _prompt_box_text(text: str) -> tuple[str, list[str]]:
    """A box's one-line label for a prompt, and the text its tooltip shows."""
    return " ".join(text.split())[:80], [text[:500]]


def _branch_map(
    graph: dict[str, dict],
    editor: dict[str, EditorNode],
    root: str,
    members: list[str],
    live: set[str],
    bypassed: set[str],
    prompts: list[PromptText],
    stages: tuple[set[str], set[str], set[str]],
    subgraph_labels: dict[str, str],
) -> list[MapNode]:
    """The output's passes and what feeds them: models, LoRAs, input media and prompts.

    Each box links to the nearest boxes downstream. A prompt never blocks the walk, since its
    text often sits on a node that also takes the image or the model. A chain of LoRA loaders
    is one box. An earlier stage's result, such as a generated reference image, is an input
    box named by that stage's prompt. Empty when nothing on the branch samples.
    """
    boxes = {step: box for step in members if step != root and (box := _map_box(graph, step))}
    if not any(kind == "pass" for kind, _, _ in boxes.values()):
        return []
    prompt_ids: dict[str, list[str]] = {}
    for prompt in prompts:
        prompt_ids.setdefault(prompt.node_id, []).append(_prompt_box_id(prompt))

    member_set = set(members)
    earlier: dict[str, bool] = {}
    # Earlier stages' results by node: the media they carry, judged by the input they enter.
    generated: dict[str, ComfyMediaKind] = {}
    edges: set[tuple[str, str]] = set()
    walkers = [step for step, box in boxes.items() if box[0] in ("pass", "loras")]
    for target in [root, *walkers]:
        edges.update((prompt_id, target) for prompt_id in prompt_ids.get(target, []))
        seen = {target}
        queue = [target]
        while queue:
            for input_name, source in _linked_inputs(graph, editor, queue.pop()):
                if source in seen:
                    continue
                seen.add(source)
                edges.update((prompt_id, target) for prompt_id in prompt_ids.get(source, []))
                if source in boxes:
                    # A checkpoint's VAE reaches the decode before the output; that is no flow.
                    if not (boxes[source][0] == "model" and target == root):
                        edges.add((source, target))
                    continue
                if source not in member_set:
                    if source not in earlier:
                        earlier[source] = _is_earlier_result(graph, editor, source, member_set)
                    if earlier[source] and (kind := _media_of(input_name)) is not None:
                        generated.setdefault(source, kind)
                        edges.add((source, target))
                        continue
                queue.append(source)

    def status(step: str) -> ComfyPassStatus:
        return _pass_status(step, live, bypassed)

    # LoRA loaders chained to each other become the box of the one nearest the output.
    group = {step: step for step, box in boxes.items() if box[0] == "loras"}

    def head(step: str) -> str:
        while group.get(step, step) != step:
            step = group[step]
        return step

    for source, target in edges:
        if source in group and target in group and status(source) == status(target):
            group[head(source)] = head(target)
    edges = {(head(a), head(b)) for a, b in edges if head(a) != head(b)}

    nodes: dict[str, tuple[ComfyMapNodeKind, str, list[str], ComfyPassStatus]] = {}
    roles = {_prompt_box_id(prompt): prompt.role for prompt in prompts}
    media = {
        step: kind
        for step, box in boxes.items()
        if box[0] == "input" and (kind := _loaded_media(graph.get(step)))
    }
    sources: dict[str, str] = {}
    for step, kind in generated.items():
        stage = _stage_ancestors(graph, step, stages)
        made = next((p for p in _collect_prompts(graph, stage) if p.role == "positive"), None)
        # The subgraph that made it names it best, else the earlier stage's sampler.
        named = subgraph_labels.get(_instance_id(step)) if ":" in step else None
        sources[step] = named or next(
            (_node_title(graph[s]) or _node_class(graph[s]) for s in stage if s in stages[0]),
            "An earlier stage",
        )
        label, detail = _prompt_box_text(made.text) if made else (sources[step], [])
        nodes[step] = ("input", label, detail, status(step))
        media[step] = kind
    for step, (kind, label, detail) in boxes.items():
        if kind == "loras":
            if head(step) != step:
                continue
            # Upstream first: the order the model meets them.
            chain = [member for member in reversed(members) if head(member) == step]
            detail = [lora for member in chain if member in group for lora in boxes[member][2]]
            only = _short_name(detail[0].rsplit(" (", 1)[0])
            label = only if len(detail) == 1 else f"{len(detail)} LoRAs"
        if kind == "pass" or any(step in edge for edge in edges):
            nodes[step] = (kind, label, detail, status(step))
    for prompt in prompts:
        nodes[_prompt_box_id(prompt)] = (
            "prompt",
            *_prompt_box_text(prompt.text),
            status(prompt.node_id),
        )
    nodes[root] = ("output", "Output", [], "ran")

    feeds: dict[str, list[str]] = {node_id: [] for node_id in nodes}
    for source, target in edges:
        if source in nodes and target in nodes:
            feeds[source].append(target)
    reads = {
        node_id: {source for source, targets in feeds.items() if node_id in targets}
        for node_id in nodes
    }
    position = {step: index for index, step in enumerate(members)}
    prompt_nodes = {_prompt_box_id(prompt): prompt.node_id for prompt in prompts}

    def rank(node_id: str) -> tuple[int, int]:
        step = prompt_nodes.get(node_id, node_id)
        return _MAP_KIND_ORDER[nodes[node_id][0]], -position.get(step, 0)

    # Earliest first, so the map can lay out its rows in one pass.
    ordered = _earliest_first(sorted(nodes, key=rank), reads)
    return [
        MapNode(
            id=node_id,
            kind=nodes[node_id][0],
            label=nodes[node_id][1],
            detail=nodes[node_id][2],
            status=nodes[node_id][3],
            feeds=sorted(feeds[node_id], key=ordered.index),
            role=roles.get(node_id),
            media=media.get(node_id),
            source=sources.get(node_id),
        )
        for node_id in ordered
    ]


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


def _computed_output(
    graph: dict[str, dict], node: object, slot: int, hops: int
) -> ScalarValue | None:
    """An output of a core node that computes numbers, such as the frame count of a video."""
    inputs = _node_inputs(node)
    class_type = _node_class(node)
    if class_type == "ResolutionSelector" and slot in (0, 1):
        size = resolution_selector(
            *(_scalar_at(graph, inputs.get(key), hops + 1) for key in _RESOLUTION_INPUT_KEYS)
        )
        return size[slot] if size else None
    if class_type == "ComfyMathExpression":
        values = {
            key.removeprefix("values."): _scalar_at(graph, value, hops + 1)
            for key, value in inputs.items()
            if key.startswith("values.")
        }
        if any(value is None for value in values.values()):
            return None
        result = math_expression(_scalar_at(graph, inputs.get("expression"), hops + 1), values)
        return math_expression_output(result, slot) if result is not None else None
    return None


def _scalar_at(graph: dict[str, dict], value: object, hops: int = 0) -> ScalarValue | None:
    if isinstance(value, (str, int, float, bool)):
        return value
    reference = _link_reference(value)
    if reference is None or hops >= _MAX_VALUE_HOPS:
        return None
    node = graph.get(reference[0])
    computed = _computed_output(graph, node, reference[1], hops)
    if computed is not None or reference[1] != 0:
        return computed
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


def _is_preview(graph: dict[str, dict], node: object) -> bool:
    """Whether an output writes only a temp file: a preview class, or its save flag is off."""
    if any(marker in _node_class(node).lower() for marker in _PREVIEW_CLASS_MARKERS):
        return True
    inputs = _node_inputs(node)
    return any(_scalar_at(graph, inputs.get(key)) is False for key in _SAVE_FLAG_INPUTS)


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


def _output_nodes(graph: dict[str, dict]) -> set[str]:
    """Save and preview nodes that take media; named by class, since a graph is full of dead ends.

    The name alone is weak evidence: Save Text File writes text, a LoRA saver writes a model,
    and ModelPreviewOverrideKJ patches a model's sampling preview. Whether the node is consumed
    does not matter: the editor can give PreviewImage a passthrough output.
    """
    outputs: set[str] = set()
    for node_id, node in graph.items():
        lowered = _node_class(node).lower()
        named = any(marker in lowered for marker in _SAVE_CLASS_MARKERS + _PREVIEW_CLASS_MARKERS)
        if lowered in _EXTRA_OUTPUT_CLASSES or (
            named and _MEDIA_INPUTS & _node_inputs(node).keys()
        ):
            outputs.add(node_id)
    return outputs


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
    definitions_by_id: dict[str, dict] = {}
    for definition in subgraphs:
        if not isinstance(definition, dict):
            continue
        identifier = definition.get("id")
        name = definition.get("name")
        if isinstance(identifier, str):
            definitions_by_id[identifier] = definition
        if isinstance(identifier, str) and isinstance(name, str) and name.strip():
            names[identifier] = name.strip()

    labels: dict[str, str] = {}

    def label_of(node: dict) -> str | None:
        title = node.get("title")
        label = title if isinstance(title, str) and title.strip() else names.get(node.get("type"))
        return label.strip() if label else None

    # Nested instances are keyed by their flattened path, such as `9:20`.
    def visit_nested(definition: dict, prefix: str, depth: int) -> None:
        nodes = definition.get("nodes")
        for node in nodes if isinstance(nodes, list) and depth < _MAX_VALUE_HOPS else []:
            inner = definitions_by_id.get(node.get("type")) if isinstance(node, dict) else None
            if inner is None:
                continue
            identifier = f"{prefix}{node.get('id')}"
            if label := label_of(node):
                labels[identifier] = label
            visit_nested(inner, f"{identifier}:", depth + 1)

    nodes = workflow.get("nodes")
    for node in nodes if isinstance(nodes, list) else []:
        if not isinstance(node, dict):
            continue
        if label := label_of(node):
            labels[str(node.get("id"))] = label
        if (definition := definitions_by_id.get(node.get("type"))) is not None:
            visit_nested(definition, f"{node.get('id')}:", 1)

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


def _metadata_values(file_path: Path) -> dict[str, str]:
    values = read_media_metadata_values(file_path)
    # Top level wins: a PNG names its chunks, and only a container that cannot needs unwrapping.
    return {**_nested_values(values), **values} if values else {}


def _editor_workflow(values: dict[str, str]) -> str | None:
    """The editor-format workflow as stored, if ComfyUI would load it from a paste.

    ComfyUI's paste handler loads plain text only when it carries ``version``, ``nodes`` and
    ``extra``; the API-format ``prompt`` is pasted as nothing.
    """
    for key in ("workflow", "Workflow", "WORKFLOW"):
        raw = values.get(key)
        workflow = _parse_workflow(raw or "")
        if workflow:
            pasteable = all(workflow.get(field) for field in ("version", "nodes", "extra"))
            return raw if pasteable else None
    return None


def read_editor_workflow(file_path: Path) -> str | None:
    return _editor_workflow(_metadata_values(file_path))


def _declared_sizes(graph: dict[str, dict], ancestry: list[str], key: str) -> frozenset[int]:
    values = (_scalar_at(graph, _node_inputs(graph.get(node_id)).get(key)) for node_id in ancestry)
    return frozenset(
        int(value)
        for value in values
        if isinstance(value, int | float) and not isinstance(value, bool) and value > 0
    )


def _media_size(file_path: Path) -> tuple[int, int] | None:
    try:
        stat = file_path.stat()
    except OSError:
        return None
    media_type = "image" if file_path.suffix.lower() == ".png" else "video"
    return media_dimensions(file_path, media_type, stat.st_mtime_ns, stat.st_size)


def _size_tiebreak(candidates: list[OutputBranch], file_path: Path) -> OutputBranch | None:
    """The one same-named output set to render at the file's size, or None.

    A stage without a readable size is never ruled out. The frame count is no help: frame
    interpolation and chained segments multiply it, so the generated length rarely matches.
    """
    if len(candidates) < 2 or not any(branch.widths and branch.heights for branch in candidates):
        return None
    size = _media_size(file_path)
    if size is None:
        return None
    fitting = [
        branch
        for branch in candidates
        if not (branch.widths and branch.heights)
        or (size[0] in branch.widths and size[1] in branch.heights)
    ]
    return fitting[0] if len(fitting) == 1 else None


def _sort_branches(branches: list[OutputBranch], matched_id: str | None) -> list[OutputBranch]:
    """The likely output first, since the dialog opens on it."""
    return sorted(
        branches,
        key=lambda branch: (
            branch.node_id != matched_id,
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
    values = _metadata_values(file_path)
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
        return _empty()

    subgraph_labels = _subgraph_labels(workflow)
    graph = _with_virtual_routes(graph, workflow)

    branches: list[OutputBranch] = []
    covered: set[str] = set()
    outputs = _output_nodes(graph)
    stages = _generation_stages(graph, outputs)
    editor = flatten_editor_graph(workflow)
    # The prompt wins: a stand-in only fills in what never ran.
    full = {
        **{node_id: _stand_in(entry) for node_id, entry in editor.items() if entry.bypassed},
        **graph,
    }

    for node_id, node in graph.items():
        class_type = _node_class(node)
        if node_id not in outputs:
            continue

        # Earlier stages are excluded from the branch but still feed it, so they are no orphans.
        covered.update(_ancestors(graph, node_id))
        ancestry = _stage_ancestors(graph, node_id, stages)
        live = _live_nodes(graph, node_id)
        ran = [step for step in ancestry if step in live]
        prefix = _declared_name(graph, node, "filename_prefix")
        filename = _declared_name(graph, node, "filename")
        bypassed = _bypassed_on_path(graph, editor, node_id, set(ancestry))
        shared, passes = _split_by_pass(full, ancestry, bypassed, live, editor, subgraph_labels)
        prompts = _collect_prompts(graph, ran)
        members = ancestry + bypassed
        branch_map = _branch_map(
            full,
            editor,
            node_id,
            members,
            live,
            set(bypassed),
            prompts,
            stages,
            subgraph_labels,
        )
        parameters, loras = _collect_parameters(graph, shared)

        branches.append(
            OutputBranch(
                node_id=node_id,
                class_type=class_type,
                label=_branch_label(node, ancestry, subgraph_labels),
                filename_prefix=prefix,
                filename=filename,
                is_preview=_is_preview(graph, node),
                matches_filename=_matches_filename(prefix, filename, file_path, class_type),
                prompts=prompts,
                parameters=parameters,
                loras=loras,
                stages=passes,
                map=branch_map,
                widths=_declared_sizes(graph, ran, "width"),
                heights=_declared_sizes(graph, ran, "height"),
            )
        )

    # A temp file shares a saved file's name pattern, so a preview claims the file only when no
    # saving output does: then the file was copied out of the temp folder.
    if any(branch.matches_filename and not branch.is_preview for branch in branches):
        for branch in branches:
            branch.matches_filename = branch.matches_filename and not branch.is_preview
    claimants = [branch for branch in branches if branch.matches_filename]
    by_size = _size_tiebreak(claimants, file_path)
    matched = claimants[0] if len(claimants) == 1 else by_size
    matched_id = matched.node_id if matched else None
    orphans = _collect_prompts(graph, [node_id for node_id in graph if node_id not in covered])

    return WorkflowPrompts(
        has_workflow=True,
        source="prompt",
        branches=_sort_branches(branches, matched_id),
        matched_node_id=matched_id,
        orphan_prompts=orphans,
        has_editor_workflow=_editor_workflow(values) is not None,
        matched_by_size=by_size is not None,
    )
