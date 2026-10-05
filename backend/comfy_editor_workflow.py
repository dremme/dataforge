"""Cut an editor-format ComfyUI workflow down to what one output node depends on."""

from __future__ import annotations

import json
from typing import Any

_MAX_SUBGRAPH_DEPTH = 12


def _link_ends(link: object) -> tuple[str, str, object, str] | None:
    """``(link id, origin node id, origin slot, target node id)`` from either link layout."""
    if isinstance(link, list) and len(link) >= 5:
        link_id, origin, slot, target = link[:4]
    elif isinstance(link, dict):
        link_id, origin, target = link.get("id"), link.get("origin_id"), link.get("target_id")
        slot = link.get("origin_slot")
    else:
        return None
    if link_id is None or origin is None or target is None:
        return None
    return str(link_id), str(origin), slot, str(target)


def _dicts(value: object) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _route_name(node: dict[str, Any]) -> str | None:
    """The name a KJ Get or Set node pairs on."""
    widgets = node.get("widgets_values")
    name = widgets[0] if isinstance(widgets, list) and widgets else None
    return name if isinstance(name, str) and name else None


def _inner_getter_names(
    node_type: object, definitions: dict[str, dict[str, Any]], depth: int = 0
) -> set[str]:
    """Get names a subgraph reads from outside: a Set node in the same scope wins."""
    definition = definitions.get(node_type) if isinstance(node_type, str) else None
    if definition is None or depth >= _MAX_SUBGRAPH_DEPTH:
        return set()
    names: set[str] = set()
    local: set[str] = set()
    for node in _dicts(definition.get("nodes")):
        name = _route_name(node)
        if node.get("type") == "GetNode" and name:
            names.add(name)
        elif node.get("type") == "SetNode" and name:
            local.add(name)
        names |= _inner_getter_names(node.get("type"), definitions, depth + 1)
    return names - local


def _set_link_origin(link: object, origin: object, slot: object) -> None:
    if isinstance(link, list):
        link[1], link[2] = origin, slot
    elif isinstance(link, dict):
        link["origin_id"], link["origin_slot"] = origin, slot


def _resolve_getters(
    by_id: dict[str, dict[str, Any]],
    links: dict[str, object],
    origins: dict[str, tuple[str, object]],
    setters: dict[str, list[str]],
) -> None:
    """Rewire every top-level Get node's links to what feeds its Set node.

    Both nodes are then left unlinked, so the walk never keeps them. A name with several Set
    nodes, or none fed, stays a Get node: there is no single source to rewire to.
    """

    def source(name: str, depth: int = 0) -> tuple[str, object] | None:
        found = setters.get(name, [])
        if len(found) != 1 or depth >= _MAX_SUBGRAPH_DEPTH:
            return None
        inputs = _dicts(by_id[found[0]].get("inputs"))
        origin = origins.get(str(inputs[0].get("link"))) if inputs else None
        if origin is None or origin[0] not in by_id:
            return None
        feeder = by_id[origin[0]]
        if feeder.get("type") == "GetNode" and (inner := _route_name(feeder)):
            return source(inner, depth + 1)
        return origin

    for getter in list(by_id.values()):
        name = _route_name(getter) if getter.get("type") == "GetNode" else None
        resolved = source(name) if name else None
        if resolved is None:
            continue
        origin_id, slot = resolved
        outputs = _dicts(by_id[origin_id].get("outputs"))
        if not isinstance(slot, int) or not 0 <= slot < len(outputs):
            continue
        target = outputs[slot]
        for output in _dicts(getter.get("outputs")):
            for link_id in output.get("links") or []:
                link = links.get(str(link_id))
                if link is None:
                    continue
                _set_link_origin(link, by_id[origin_id]["id"], slot)
                origins[str(link_id)] = (origin_id, slot)
                target["links"] = [*(target.get("links") or []), link_id]
            output["links"] = []


def _inside(group: dict[str, Any], node: dict[str, Any]) -> bool:
    bounding, pos = group.get("bounding"), node.get("pos")
    if not (isinstance(bounding, list) and len(bounding) == 4 and isinstance(pos, list)):
        return False
    if len(pos) < 2:
        return False
    x, y = pos[:2]
    left, top, width, height = bounding
    return left <= x <= left + width and top <= y <= top + height


def _prune_reroutes(extra: dict[str, Any], kept_links: set[str]) -> None:
    """Keep native reroutes a kept link runs through, with the reroutes they hang from."""
    extensions = [
        entry for entry in _dicts(extra.get("linkExtensions")) if str(entry.get("id")) in kept_links
    ]
    if "linkExtensions" in extra:
        extra["linkExtensions"] = extensions
    reroutes = {str(entry.get("id")): entry for entry in _dicts(extra.get("reroutes"))}
    if not reroutes:
        return

    used: set[str] = set()
    pending = [str(entry.get("parentId")) for entry in extensions]
    pending += [
        reroute_id
        for reroute_id, entry in reroutes.items()
        if any(str(link) in kept_links for link in entry.get("linkIds") or [])
    ]
    while pending:
        reroute_id = pending.pop()
        if reroute_id in used or reroute_id not in reroutes:
            continue
        used.add(reroute_id)
        pending.append(str(reroutes[reroute_id].get("parentId")))

    extra["reroutes"] = [
        {
            **entry,
            "linkIds": [link for link in entry.get("linkIds") or [] if str(link) in kept_links],
        }
        for reroute_id, entry in reroutes.items()
        if reroute_id in used
    ]


def workflow_for_output(raw: str, node_id: str) -> str | None:
    """The workflow trimmed to the nodes ``node_id`` depends on, or None if it is not there.

    ``node_id`` is an API-format id; a ``parent:child`` id keeps its whole subgraph instance,
    because a definition is shared by every instance and cannot be cut for one of them. Walking
    the editor graph keeps what the API format drops, such as reroutes and primitives. Get
    nodes are rewired to their source; a Set node stays only for a Get inside a kept subgraph.
    """
    try:
        workflow = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(workflow, dict):
        return None

    nodes = [node for node in _dicts(workflow.get("nodes")) if node.get("id") is not None]
    by_id = {str(node["id"]): node for node in nodes}
    root = node_id.split(":", 1)[0]
    if root not in by_id:
        return None

    links: dict[str, object] = {}
    origins: dict[str, tuple[str, object]] = {}
    for link in workflow.get("links") or []:
        ends = _link_ends(link)
        if ends is not None:
            links[ends[0]] = link
            origins[ends[0]] = (ends[1], ends[2])

    setters: dict[str, list[str]] = {}
    for node in nodes:
        if node.get("type") == "SetNode" and (name := _route_name(node)):
            setters.setdefault(name, []).append(str(node["id"]))
    _resolve_getters(by_id, links, origins, setters)

    definitions = workflow.get("definitions")
    subgraphs = {
        entry["id"]: entry
        for entry in _dicts(definitions.get("subgraphs") if isinstance(definitions, dict) else [])
        if isinstance(entry.get("id"), str)
    }

    kept = {root}
    queue = [root]
    while queue:
        node = by_id[queue.pop()]
        sources = [
            origins[str(entry.get("link"))][0]
            for entry in _dicts(node.get("inputs"))
            if str(entry.get("link")) in origins
        ]
        names = _inner_getter_names(node.get("type"), subgraphs)
        if node.get("type") == "GetNode" and (name := _route_name(node)):
            names.add(name)
        sources += [setter for name in names for setter in setters.get(name, [])]
        for source in sources:
            if source in by_id and source not in kept:
                kept.add(source)
                queue.append(source)

    kept_links = {
        ends[0]
        for link in links.values()
        if (ends := _link_ends(link)) is not None and ends[1] in kept and ends[3] in kept
    }
    kept_nodes = [node for node in nodes if str(node["id"]) in kept]
    for node in kept_nodes:
        # A link from a node missing in the file is dangling; ComfyUI reports it on load.
        for entry in _dicts(node.get("inputs")):
            if entry.get("link") is not None and str(entry["link"]) not in kept_links:
                entry["link"] = None
        for output in _dicts(node.get("outputs")):
            if isinstance(output.get("links"), list):
                output["links"] = [link for link in output["links"] if str(link) in kept_links]

    workflow["nodes"] = kept_nodes
    workflow["links"] = [
        link
        for link in workflow.get("links") or []
        if (ends := _link_ends(link)) is not None and ends[0] in kept_links
    ]
    workflow["groups"] = [
        group
        for group in _dicts(workflow.get("groups"))
        if any(_inside(group, node) for node in kept_nodes)
    ]
    if isinstance(workflow.get("extra"), dict):
        _prune_reroutes(workflow["extra"], kept_links)
    return json.dumps(workflow, ensure_ascii=False)
