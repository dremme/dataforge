import json
from collections.abc import Callable
from pathlib import Path

from caption_cache import cached_by_stat
from constants import (
    CAPTION_JSON_KEYS,
    CAPTION_SIDECAR_EXTENSIONS,
    ISSUE_FIX_SENTINELS,
    ISSUE_SIDECAR_SUFFIX,
    MAX_ISSUE_FIXES,
)


def _caption_text_from_json_value(value: object) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, list):
        parts = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        if parts:
            return ", ".join(parts)
        if len(value) == 1:
            return _caption_text_from_json_value(value[0])
        return None
    if isinstance(value, dict):
        return _caption_text_from_json(value)
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text or None


def _caption_text_from_json(data: object) -> str | None:
    if isinstance(data, str):
        text = data.strip()
        return text or None

    if isinstance(data, list):
        if len(data) == 1:
            return _caption_text_from_json(data[0])
        return None

    if not isinstance(data, dict):
        return None

    for key in CAPTION_JSON_KEYS:
        if key not in data:
            continue
        text = _caption_text_from_json_value(data[key])
        if text:
            return text

    for value in data.values():
        if isinstance(value, dict):
            text = _caption_text_from_json(value)
            if text:
                return text

    if len(data) == 1:
        return _caption_text_from_json_value(next(iter(data.values())))

    return None


def _element_label(element: dict) -> str | None:
    for key in ("desc", "text", "label", "name"):
        value = element.get(key)
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
    return None


def _raw_bbox_values(raw_bbox: object) -> tuple[float, float, float, float] | None:
    if not isinstance(raw_bbox, (list, tuple)) or len(raw_bbox) != 4:
        return None

    try:
        return tuple(float(value) for value in raw_bbox)
    except (TypeError, ValueError):
        return None


def _bbox_uses_pixel_coords(raw_bboxes: list[tuple[float, float, float, float]]) -> bool:
    return any(max(coords) > 1000 for coords in raw_bboxes)


def _parse_bbox_coords(
    coords: tuple[float, float, float, float],
    *,
    use_pixel_coords: bool,
    image_width: int | None = None,
    image_height: int | None = None,
) -> tuple[float, float, float, float] | None:
    a, b, c, d = coords

    if use_pixel_coords:
        x1, x2 = sorted((a, c))
        y1, y2 = sorted((b, d))
    else:
        # ai-toolkit Ideogram4 captions store normalized boxes as [y1, x1, y2, x2].
        y1, x1, y2, x2 = a, b, c, d
        y1, y2 = sorted((y1, y2))
        x1, x2 = sorted((x1, x2))
        if image_width and image_height:
            x1 = x1 / 1000 * image_width
            x2 = x2 / 1000 * image_width
            y1 = y1 / 1000 * image_height
            y2 = y2 / 1000 * image_height

    if x2 <= x1 or y2 <= y1:
        return None

    return x1, y1, x2, y2


def _iter_json_bbox_elements(data: object) -> list[dict]:
    if not isinstance(data, dict):
        return []

    elements: list[object] = []
    decon = data.get("compositional_deconstruction")
    if isinstance(decon, dict) and isinstance(decon.get("elements"), list):
        elements.extend(decon["elements"])
    if isinstance(data.get("elements"), list):
        elements.extend(data["elements"])

    return [element for element in elements if isinstance(element, dict) and "bbox" in element]


def _json_has_bboxes(data: object) -> bool:
    for element in _iter_json_bbox_elements(data):
        if _raw_bbox_values(element["bbox"]) is not None:
            return True
    return False


def _extract_bboxes_from_json(
    data: object,
    image_width: int | None = None,
    image_height: int | None = None,
) -> list[dict[str, object]]:
    if not isinstance(data, dict):
        return []

    elements = _iter_json_bbox_elements(data)

    raw_bboxes: list[tuple[float, float, float, float]] = []
    parsed_elements: list[dict] = []
    for element in elements:
        coords = _raw_bbox_values(element["bbox"])
        if coords is None:
            continue

        raw_bboxes.append(coords)
        parsed_elements.append(element)

    if not parsed_elements:
        return []

    use_pixel_coords = _bbox_uses_pixel_coords(raw_bboxes)
    bboxes: list[dict[str, object]] = []
    for element, coords in zip(parsed_elements, raw_bboxes, strict=True):
        parsed_coords = _parse_bbox_coords(
            coords,
            use_pixel_coords=use_pixel_coords,
            image_width=image_width,
            image_height=image_height,
        )
        if parsed_coords is None:
            continue

        x1, y1, x2, y2 = parsed_coords
        bbox_item: dict[str, object] = {
            "x1": round(x1, 2),
            "y1": round(y1, 2),
            "x2": round(x2, 2),
            "y2": round(y2, 2),
        }

        element_type = element.get("type")
        if isinstance(element_type, str) and element_type.strip():
            bbox_item["type"] = element_type.strip()

        label = _element_label(element)
        if label:
            bbox_item["label"] = label

        bboxes.append(bbox_item)

    return bboxes


def _read_caption_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError:
        return None


def _parse_json_caption_text(raw: str) -> object | None:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _json_summary_from_data(
    data: object | None,
) -> tuple[str | None, bool, str]:
    if data is None:
        return None, False, "empty"

    description = _caption_text_from_json(data)
    has_bboxes = _json_has_bboxes(data)
    if description:
        return description, has_bboxes, "text"
    if has_bboxes:
        return None, True, "bboxes_only"
    return None, False, "empty"


def resolve_caption_file_name(
    stem: str, exists: Callable[[str], bool]
) -> tuple[str | None, str | None]:
    """Winning sidecar name + type for ``stem``, given a name-existence check.

    Sole authority on caption precedence: a ``.json`` sidecar always beats a ``.txt``
    one. Taking an ``exists`` callback lets a caller that has already enumerated the
    directory answer from that listing instead of probing the filesystem again.
    """
    for extension in CAPTION_SIDECAR_EXTENSIONS:
        name = f"{stem}{extension}"
        if exists(name):
            return name, extension.lstrip(".")

    return None, None


def resolve_caption_file(media_path: Path) -> tuple[Path | None, str | None]:
    """The caption sidecar that wins for ``media_path``, as ``(path, "json" | "txt")``."""
    folder = media_path.parent
    name, caption_file_type = resolve_caption_file_name(
        media_path.stem,
        lambda candidate: (folder / candidate).is_file(),
    )
    if name is None:
        return None, None
    return folder / name, caption_file_type


def _caption_summary_from_raw(
    raw_content: str | None,
    caption_file_type: str | None,
) -> tuple[str | None, bool, str, object | None]:
    """Summarize sidecar text that has already been read off disk.

    Returns ``(description, has_bboxes, caption_status, json_data)``; the parsed
    JSON rides along so callers needing bboxes do not have to parse a second time.
    Assumes a sidecar exists, so an unusable one reports ``"empty"`` rather than
    ``"none"``.
    """
    if caption_file_type == "json":
        data = _parse_json_caption_text(raw_content) if raw_content is not None else None
        description, has_bboxes, caption_status = _json_summary_from_data(data)
        return description, has_bboxes, caption_status, data

    if raw_content is not None:
        text = raw_content.strip()
        if text:
            return text, False, "text", None

    return None, False, "empty", None


def caption_summary_from_sidecar(
    sidecar_path: Path,
    caption_file_type: str,
    mtime_ns: int,
    size: int,
) -> tuple[str | None, bool, str, str | None]:
    """:func:`load_caption_summary` for a sidecar the caller has already stat'ed.

    Memoized on the stat signature, so an unchanged folder re-browses without
    touching a single caption file.
    """

    def load() -> tuple[str | None, bool, str, str | None]:
        raw_content = _read_caption_text(sidecar_path)
        description, has_bboxes, caption_status, _ = _caption_summary_from_raw(
            raw_content,
            caption_file_type,
        )
        return description, has_bboxes, caption_status, caption_file_type

    return cached_by_stat("caption", sidecar_path, mtime_ns, size, load)


def _load_caption_bundle(
    media_path: Path,
    *,
    image_width: int | None = None,
    image_height: int | None = None,
) -> dict[str, object]:
    raw_content: str | None = None
    description: str | None = None
    has_bboxes = False
    caption_status = "none"
    bboxes: list[dict[str, object]] = []

    caption_path, caption_file_type = resolve_caption_file(media_path)

    if caption_path is not None:
        raw_content = _read_caption_text(caption_path)
        description, has_bboxes, caption_status, data = _caption_summary_from_raw(
            raw_content,
            caption_file_type,
        )
        if data is not None:
            bboxes = _extract_bboxes_from_json(data, image_width, image_height)

    return {
        "description": description,
        "has_bboxes": has_bboxes,
        "caption_status": caption_status,
        "caption_file_type": caption_file_type,
        "caption_path": caption_path,
        "raw_content": raw_content,
        "bboxes": bboxes,
    }


def load_caption_summary(
    media_path: Path,
) -> tuple[str | None, bool, str, str | None]:
    bundle = _load_caption_bundle(media_path)
    return (
        bundle["description"],  # type: ignore[return-value]
        bundle["has_bboxes"],  # type: ignore[return-value]
        bundle["caption_status"],  # type: ignore[return-value]
        bundle["caption_file_type"],  # type: ignore[return-value]
    )


def media_has_caption_text(media_path: Path) -> bool:
    description, _, caption_status, _ = load_caption_summary(media_path)
    return description is not None and caption_status == "text"


DEFAULT_CAPTION_JSON_KEY = "description"

NO_CAPTION_STATUS = "no_caption"


def load_reference_caption(media_path: Path) -> tuple[str | None, str]:
    """Caption text for jobs that read an existing caption, honouring precedence.

    Returns ``(text, "ok")`` when the winning sidecar holds text, otherwise
    ``(None, status)`` with ``no_caption`` for a missing or textless sidecar.
    """
    caption_path, caption_type = resolve_caption_file(media_path)
    if caption_path is None:
        return None, NO_CAPTION_STATUS

    raw = _read_caption_text(caption_path)
    if raw is None:
        return None, f"read_error: could not read {caption_path.name}"

    if caption_type == "json":
        text = _caption_text_from_json(_parse_json_caption_text(raw))
    else:
        text = raw.strip() or None

    if not text:
        return None, NO_CAPTION_STATUS

    return text, "ok"


def _find_caption_location(data: object) -> tuple[dict[str, object], str] | None:
    if isinstance(data, dict):
        for key in CAPTION_JSON_KEYS:
            if key not in data:
                continue
            value = data[key]
            if isinstance(value, str):
                return data, key
            if isinstance(value, list):
                if any(isinstance(item, str) and item.strip() for item in value):
                    return data, key
                if len(value) == 1:
                    nested = _find_caption_location(value[0])
                    if nested:
                        return nested
            if isinstance(value, dict):
                nested = _find_caption_location(value)
                if nested:
                    return nested

        for value in data.values():
            if isinstance(value, dict):
                nested = _find_caption_location(value)
                if nested:
                    return nested

        if len(data) == 1:
            only_key = next(iter(data))
            only_value = data[only_key]
            if isinstance(only_value, str):
                return data, only_key
            if isinstance(only_value, dict):
                nested = _find_caption_location(only_value)
                if nested:
                    return nested

    return None


def _pixel_bbox_to_raw(
    bbox: dict[str, object],
    *,
    use_pixel_coords: bool,
    image_width: int | None = None,
    image_height: int | None = None,
) -> list[float]:
    x1 = float(bbox["x1"])
    y1 = float(bbox["y1"])
    x2 = float(bbox["x2"])
    y2 = float(bbox["y2"])

    if use_pixel_coords:
        return [round(x1), round(y1), round(x2), round(y2)]

    if not image_width or not image_height:
        raise ValueError("Image dimensions required to save normalized bounding boxes")

    return [
        round(y1 / image_height * 1000),
        round(x1 / image_width * 1000),
        round(y2 / image_height * 1000),
        round(x2 / image_width * 1000),
    ]


def _resolve_bbox_save_format(
    raw_bboxes: list[tuple[float, float, float, float]],
    bboxes: list[dict[str, object]],
) -> bool:
    if not raw_bboxes or not _bbox_uses_pixel_coords(raw_bboxes):
        return False

    return any(
        max(
            float(bbox["x1"]),
            float(bbox["y1"]),
            float(bbox["x2"]),
            float(bbox["y2"]),
        )
        > 1000
        for bbox in bboxes
    )


def _update_json_bboxes(
    data: dict[str, object],
    bboxes: list[dict[str, object]],
    *,
    image_width: int | None = None,
    image_height: int | None = None,
) -> dict[str, object]:
    elements = _iter_json_bbox_elements(data)
    if not elements:
        return data

    raw_bboxes: list[tuple[float, float, float, float]] = []
    for element in elements:
        coords = _raw_bbox_values(element["bbox"])
        if coords is not None:
            raw_bboxes.append(coords)

    use_pixel_coords = _resolve_bbox_save_format(raw_bboxes, bboxes)

    for index, element in enumerate(elements):
        if index >= len(bboxes):
            break
        element["bbox"] = _pixel_bbox_to_raw(
            bboxes[index],
            use_pixel_coords=use_pixel_coords,
            image_width=image_width,
            image_height=image_height,
        )

    return data


def _update_json_caption(data: object, text: str) -> dict[str, object]:
    if not isinstance(data, dict):
        data = {}

    location = _find_caption_location(data)
    if location:
        container, key = location
        container[key] = text
    else:
        data[DEFAULT_CAPTION_JSON_KEY] = text

    return data


def _caption_media_dimensions(media_path: Path) -> tuple[int | None, int | None]:
    from media_listing import get_media_type
    from media_metadata import get_media_dimensions

    media_type = get_media_type(media_path) or "image"
    dimensions = get_media_dimensions(media_path, media_type)
    if not dimensions:
        return None, None
    return dimensions


def build_caption_response(media_path: Path) -> dict[str, object]:
    image_width, image_height = _caption_media_dimensions(media_path)
    bundle = _load_caption_bundle(
        media_path,
        image_width=image_width,
        image_height=image_height,
    )
    description = bundle["description"]
    bboxes = bundle["bboxes"]
    caption_status = bundle["caption_status"]
    caption_path = bundle["caption_path"]
    caption_type = bundle["caption_file_type"]

    issue_fixes, has_issue_file = load_issue_summary(media_path)

    return {
        "description": description,
        "has_description": description is not None,
        "has_caption_file": caption_status != "none",
        "caption_status": caption_status,
        "caption_file": str(caption_path) if caption_path else "",
        "caption_file_type": caption_type,
        "caption_content": bundle["raw_content"],
        "bboxes": bboxes,
        "has_bboxes": bool(bboxes),
        "issue_fixes": issue_fixes,
        "has_issue_file": has_issue_file,
    }


def _write_json_caption_file(caption_path: Path, json_content: str) -> None:
    try:
        data = json.loads(json_content)
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid JSON") from exc

    if not isinstance(data, (dict, list)):
        raise ValueError("Caption JSON must be an object or array")

    caption_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _complete_save_response(
    media_path: Path,
    *,
    caption_path: Path,
    caption_type: str,
    resolve_issue: bool,
) -> dict[str, object]:
    if resolve_issue:
        delete_issue_file(media_path)

    response = build_caption_response(media_path)
    response["has_caption_file"] = True
    response["caption_file"] = str(caption_path)
    response["caption_file_type"] = caption_type
    return response


def save_caption(
    media_path: Path,
    text: str,
    bboxes: list[dict[str, object]] | None = None,
    json_content: str | None = None,
    *,
    resolve_issue: bool = False,
) -> dict[str, object]:
    caption_path, caption_type = resolve_caption_file(media_path)
    normalized = text.strip()
    image_width, image_height = _caption_media_dimensions(media_path)

    if json_content is not None:
        if caption_type != "json":
            raise ValueError("Full JSON editing is only supported for JSON caption files")
        if caption_path is None:
            raise ValueError("Caption file path missing for JSON caption")
        _write_json_caption_file(caption_path, json_content)
        return _complete_save_response(
            media_path,
            caption_path=caption_path,
            caption_type=caption_type,
            resolve_issue=resolve_issue,
        )

    if caption_type == "json":
        if caption_path is None:
            raise ValueError("Caption file path missing for JSON caption")
        try:
            raw = caption_path.read_text(encoding="utf-8-sig")
            data = json.loads(raw) if raw.strip() else {}
        except (json.JSONDecodeError, OSError) as exc:
            raise ValueError("Caption JSON file is unreadable") from exc

        updated = _update_json_caption(data, normalized)
        if bboxes is not None:
            if not isinstance(updated, dict):
                updated = {}
            updated = _update_json_bboxes(
                updated,
                bboxes,
                image_width=image_width,
                image_height=image_height,
            )
        caption_path.write_text(
            json.dumps(updated, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    elif caption_type == "txt":
        if caption_path is None:
            raise ValueError("Caption file path missing for text caption")
        caption_path.write_text(normalized + ("\n" if normalized else ""), encoding="utf-8")
    else:
        caption_path = media_path.parent / f"{media_path.stem}.txt"
        caption_type = "txt"
        caption_path.write_text(normalized + ("\n" if normalized else ""), encoding="utf-8")

    return _complete_save_response(
        media_path,
        caption_path=caption_path,
        caption_type=caption_type,
        resolve_issue=resolve_issue,
    )


def issue_file_path(media_path: Path) -> Path:
    return media_path.with_suffix(ISSUE_SIDECAR_SUFFIX)


def delete_issue_file(media_path: Path) -> None:
    issue_path = issue_file_path(media_path)
    if not issue_path.is_file():
        return
    issue_path.unlink()


def normalize_issue_fixes(value: object) -> list[str]:
    """Keep the substantive string entries of a fix list, capped at ``MAX_ISSUE_FIXES``."""
    if not isinstance(value, list):
        return []

    fixes = []
    for entry in value:
        if not isinstance(entry, str):
            continue
        text = entry.strip()
        if not text or text.lower() in ISSUE_FIX_SENTINELS:
            continue
        fixes.append(text)
        if len(fixes) == MAX_ISSUE_FIXES:
            break

    return fixes


def _issue_fixes_from_file(issue_path: Path) -> tuple[str, ...]:
    """Fixes held by an issue sidecar known to exist.

    A sidecar that carries no usable ``fixes`` array - unreadable, malformed, or
    written in a superseded format - yields no fixes while still counting as
    present, so the resolver surfaces it as a broken issue file instead of
    silently hiding it.
    """
    try:
        data = json.loads(issue_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ()

    if not isinstance(data, dict):
        return ()

    return tuple(normalize_issue_fixes(data.get("fixes")))


def issue_summary_from_sidecar(
    issue_path: Path,
    mtime_ns: int,
    size: int,
) -> tuple[list[str], bool]:
    """:func:`load_issue_summary` for a sidecar the caller has already stat'ed."""
    fixes = cached_by_stat(
        "issue",
        issue_path,
        mtime_ns,
        size,
        lambda: _issue_fixes_from_file(issue_path),
    )
    # A fresh list per call - the cache hands back the same tuple every time.
    return list(fixes), True


def load_issue_summary(media_path: Path) -> tuple[list[str], bool]:
    """Return the sidecar's fixes and whether a sidecar exists at all."""
    issue_path = issue_file_path(media_path)
    if not issue_path.is_file():
        return [], False

    return list(_issue_fixes_from_file(issue_path)), True
