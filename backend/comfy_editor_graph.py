"""The editor-format ComfyUI workflow flattened to the ids the API-format ``prompt`` uses.

The ``prompt`` chunk holds only what ran: bypassed nodes are dropped from it, while the
``workflow`` chunk keeps them with their links. Flattening gives every node inside a subgraph
its ``instance:inner`` path and resolves links across subgraph boundaries, so the two graphs
can be read side by side.
"""

from __future__ import annotations

from dataclasses import dataclass, field

_MAX_SUBGRAPH_DEPTH = 12
_BYPASS_MODE = 4
_SUBGRAPH_INPUT = "-10"
_SUBGRAPH_OUTPUT = "-20"

type Source = tuple[str, int]


@dataclass
class EditorNode:
    class_type: str
    title: str | None
    #: Bypassed itself or inside a bypassed subgraph instance.
    bypassed: bool
    #: Linked inputs by name, resolved to the node and output slot feeding them.
    links: dict[str, Source] = field(default_factory=dict)
    #: Inputs whose value a subgraph instance supplies from its own widget.
    values: dict[str, object] = field(default_factory=dict)
    #: Widget values by name; only newer ComfyUI frontends record the names.
    widgets: dict[str, object] = field(default_factory=dict)


@dataclass
class _Scope:
    prefix: str
    definition: dict
    nodes: dict[str, dict]
    links: dict[str, tuple[str, int, str, int]]
    bypassed: bool
    parent: _Scope | None = None
    instance: dict | None = None


def _dicts(value: object) -> list[dict]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _link(link: object) -> tuple[str, tuple[str, int, str, int]] | None:
    """``(link id, (origin, origin slot, target, target slot))`` from either link layout."""
    if isinstance(link, list) and len(link) >= 5:
        ends = link[:5]
    elif isinstance(link, dict):
        ends = [link.get(key) for key in ("id", "origin_id", "origin_slot", "target_id")]
        ends.append(link.get("target_slot"))
    else:
        return None
    link_id, origin, origin_slot, target, target_slot = ends
    if (
        link_id is None
        or origin is None
        or target is None
        or not isinstance(origin_slot, int)
        or not isinstance(target_slot, int)
    ):
        return None
    return str(link_id), (str(origin), origin_slot, str(target), target_slot)


def _scope(
    definition: dict, prefix: str, bypassed: bool, parent: _Scope | None, instance: dict | None
) -> _Scope:
    links = {}
    for raw in definition.get("links") or []:
        if (parsed := _link(raw)) is not None:
            links[parsed[0]] = parsed[1]
    nodes = {str(node.get("id")): node for node in _dicts(definition.get("nodes"))}
    return _Scope(prefix, definition, nodes, links, bypassed, parent, instance)


def flatten_editor_graph(workflow: object) -> dict[str, EditorNode]:
    """Every node of the editor workflow by its flattened id; empty for anything unreadable."""
    if not isinstance(workflow, dict):
        return {}
    definitions = workflow.get("definitions")
    subgraphs = {
        entry["id"]: entry
        for entry in _dicts(definitions.get("subgraphs") if isinstance(definitions, dict) else [])
        if isinstance(entry.get("id"), str)
    }
    flattened: dict[str, EditorNode] = {}

    def child_scope(scope: _Scope, node_id: str) -> _Scope | None:
        node = scope.nodes.get(node_id)
        node_type = node.get("type") if node else None
        definition = subgraphs.get(node_type) if isinstance(node_type, str) else None
        if node is None or definition is None or scope.prefix.count(":") >= _MAX_SUBGRAPH_DEPTH:
            return None
        bypassed = scope.bypassed or node.get("mode") == _BYPASS_MODE
        return _scope(definition, f"{scope.prefix}{node_id}:", bypassed, scope, node)

    def resolve(scope: _Scope, origin: str, slot: int, depth: int = 0) -> object:
        """The node and slot an origin stands for, or a literal an instance supplies."""
        if depth >= _MAX_SUBGRAPH_DEPTH * 4:
            return None
        if origin == _SUBGRAPH_INPUT:
            return outer_input(scope, slot, depth)
        inner = child_scope(scope, origin)
        if inner is None:
            return f"{scope.prefix}{origin}", slot
        for target_origin, target_origin_slot, target, target_slot in inner.links.values():
            if target == _SUBGRAPH_OUTPUT and target_slot == slot:
                return resolve(inner, target_origin, target_origin_slot, depth + 1)
        return None

    def outer_input(scope: _Scope, slot: int, depth: int) -> object:
        declared = _dicts(scope.definition.get("inputs"))
        if scope.parent is None or scope.instance is None or slot >= len(declared):
            return None
        name = declared[slot].get("name")
        entry = next(
            (item for item in _dicts(scope.instance.get("inputs")) if item.get("name") == name),
            None,
        )
        link = scope.parent.links.get(str(entry.get("link"))) if entry else None
        if link is not None:
            return resolve(scope.parent, link[0], link[1], depth + 1)
        named = scope.instance.get("widgets_values_named")
        return named.get(name) if isinstance(named, dict) else None

    def visit(scope: _Scope) -> None:
        incoming: dict[str, dict[int, tuple[str, int]]] = {}
        for origin, origin_slot, target, target_slot in scope.links.values():
            incoming.setdefault(target, {})[target_slot] = (origin, origin_slot)
        for node_id, node in scope.nodes.items():
            if node_id in (_SUBGRAPH_INPUT, _SUBGRAPH_OUTPUT):
                continue
            if (inner := child_scope(scope, node_id)) is not None:
                visit(inner)
                continue
            entry = EditorNode(
                class_type=str(node.get("type") or ""),
                title=node.get("title") if isinstance(node.get("title"), str) else None,
                bypassed=scope.bypassed or node.get("mode") == _BYPASS_MODE,
            )
            named = node.get("widgets_values_named")
            if isinstance(named, dict):
                entry.widgets = dict(named)
            inputs = _dicts(node.get("inputs"))
            for target_slot, (origin, origin_slot) in incoming.get(node_id, {}).items():
                if target_slot >= len(inputs) or not isinstance(
                    inputs[target_slot].get("name"), str
                ):
                    continue
                resolved = resolve(scope, origin, origin_slot)
                if isinstance(resolved, tuple):
                    entry.links[inputs[target_slot]["name"]] = resolved
                elif resolved is not None:
                    entry.values[inputs[target_slot]["name"]] = resolved
            flattened[f"{scope.prefix}{node_id}"] = entry

    visit(_scope(workflow, "", False, None, None))
    return flattened
