import json
from pathlib import Path

from constants import CAPTION_JSON_KEYS


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


def _load_caption_bundle(
    media_path: Path,
    *,
    image_width: int | None = None,
    image_height: int | None = None,
) -> dict[str, object]:
    stem = media_path.stem
    parent = media_path.parent
    found_caption_file = False
    caption_path: Path | None = None
    caption_file_type: str | None = None
    raw_content: str | None = None
    description: str | None = None
    has_bboxes = False
    caption_status = "none"
    bboxes: list[dict[str, object]] = []

    json_path = parent / f"{stem}.json"
    if json_path.is_file():
        found_caption_file = True
        caption_path = json_path
        caption_file_type = "json"
        raw_content = _read_caption_text(json_path)
        data = _parse_json_caption_text(raw_content) if raw_content is not None else None
        description, has_bboxes, caption_status = _json_summary_from_data(data)
        if data is not None:
            bboxes = _extract_bboxes_from_json(data, image_width, image_height)
    else:
        txt_path = parent / f"{stem}.txt"
        if txt_path.is_file():
            found_caption_file = True
            caption_path = txt_path
            caption_file_type = "txt"
            raw_content = _read_caption_text(txt_path)
            if raw_content is not None:
                text = raw_content.strip()
                if text:
                    description = text
                    caption_status = "text"

    if found_caption_file and caption_status == "none":
        caption_status = "empty"

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


def resolve_caption_file(media_path: Path) -> tuple[Path | None, str | None]:
    stem = media_path.stem
    parent = media_path.parent

    json_path = parent / f"{stem}.json"
    if json_path.is_file():
        return json_path, "json"

    txt_path = parent / f"{stem}.txt"
    if txt_path.is_file():
        return txt_path, "txt"

    return None, None


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

    issue, issue_suggestions, has_issue_file = load_issue_summary(media_path)

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
        "issue": issue,
        "issue_suggestions": issue_suggestions,
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
    return media_path.with_suffix(".issue.json")


def delete_issue_file(media_path: Path) -> None:
    issue_path = issue_file_path(media_path)
    if not issue_path.is_file():
        return
    issue_path.unlink()


def _normalize_issue_field(value: object) -> str | None:
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text or text.lower() in {"none", "n/a"}:
        return None

    return text


def _coerce_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes"}:
            return True
        if normalized in {"false", "no"}:
            return False
    return None


def _issue_sidecar_is_actionable(data: dict) -> bool:
    correct = _coerce_bool(data.get("correct"))
    issues = _normalize_issue_field(data.get("issues"))

    if correct is True:
        return False
    return issues is not None


def load_issue_summary(media_path: Path) -> tuple[str | None, str | None, bool]:
    issue_path = issue_file_path(media_path)
    if not issue_path.is_file():
        return None, None, False

    try:
        data = json.loads(issue_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, None, True

    if not isinstance(data, dict):
        return None, None, True

    issues = _normalize_issue_field(data.get("issues"))
    suggestions = _normalize_issue_field(data.get("suggestions"))

    return (
        issues,
        suggestions,
        _issue_sidecar_is_actionable(data),
    )
