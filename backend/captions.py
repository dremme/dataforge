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


def _json_summary_from_data(data: object | None) -> tuple[str | None, str]:
    if data is None:
        return None, "empty"

    description = _caption_text_from_json(data)
    if description:
        return description, "text"
    return None, "empty"


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
) -> tuple[str | None, str, object | None]:
    """Summarize sidecar text that has already been read off disk.

    Returns ``(description, caption_status, json_data)``; the parsed JSON rides
    along so callers needing the structure do not have to parse a second time.
    Assumes a sidecar exists, so an unusable one reports ``"empty"`` rather than
    ``"none"``.
    """
    if caption_file_type == "json":
        data = _parse_json_caption_text(raw_content) if raw_content is not None else None
        description, caption_status = _json_summary_from_data(data)
        return description, caption_status, data

    if raw_content is not None:
        text = raw_content.strip()
        if text:
            return text, "text", None

    return None, "empty", None


def caption_summary_from_sidecar(
    sidecar_path: Path,
    caption_file_type: str,
    mtime_ns: int,
    size: int,
) -> tuple[str | None, str, str | None]:
    """:func:`load_caption_summary` for a sidecar the caller has already stat'ed.

    Memoized on the stat signature, so an unchanged folder re-lists without
    touching a single caption file.
    """

    def load() -> tuple[str | None, str, str | None]:
        raw_content = _read_caption_text(sidecar_path)
        description, caption_status, _ = _caption_summary_from_raw(
            raw_content,
            caption_file_type,
        )
        return description, caption_status, caption_file_type

    return cached_by_stat("caption", sidecar_path, mtime_ns, size, load)


def _load_caption_bundle(media_path: Path) -> dict[str, object]:
    raw_content: str | None = None
    description: str | None = None
    caption_status = "none"

    caption_path, caption_file_type = resolve_caption_file(media_path)

    if caption_path is not None:
        raw_content = _read_caption_text(caption_path)
        description, caption_status, _ = _caption_summary_from_raw(
            raw_content,
            caption_file_type,
        )

    return {
        "description": description,
        "caption_status": caption_status,
        "caption_file_type": caption_file_type,
        "caption_path": caption_path,
        "raw_content": raw_content,
    }


def load_caption_summary(
    media_path: Path,
) -> tuple[str | None, str, str | None]:
    bundle = _load_caption_bundle(media_path)
    return (
        bundle["description"],  # type: ignore[return-value]
        bundle["caption_status"],  # type: ignore[return-value]
        bundle["caption_file_type"],  # type: ignore[return-value]
    )


def media_has_caption_text(media_path: Path) -> bool:
    description, caption_status, _ = load_caption_summary(media_path)
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


def build_caption_response(media_path: Path) -> dict[str, object]:
    bundle = _load_caption_bundle(media_path)
    description = bundle["description"]
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
    json_content: str | None = None,
    *,
    resolve_issue: bool = False,
) -> dict[str, object]:
    caption_path, caption_type = resolve_caption_file(media_path)
    normalized = text.strip()

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
    """Where ``media_path``'s findings are written: ``clip.mp4`` -> ``clip.mp4.issue.json``.

    Named after the whole filename for the reason the duplicate finding is (see
    :func:`duplicates.duplicate_file_path`): a generated folder holds ``clip.mp4`` beside
    the ``clip.png`` that previews it, and a stem-named sidecar is one file for the two of
    them. Verify-captions clears the findings of a file that reads clean, so the still
    verifying clean deleted the video's findings - order deciding which survived.

    Only this name is read. A folder written before the rename reports no findings until
    verify-captions runs again, and the files it leaves behind are what the folder-wide
    sidecar sweep is for.
    """
    return media_path.with_name(media_path.name + ISSUE_SIDECAR_SUFFIX)


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


def save_issue_fixes(media_path: Path, fixes: list[str]) -> None:
    """Write the sidecar's fixes, or remove it when there are none left to record.

    Verify-captions is the only writer. Duplicate findings live in their own
    ``.duplicate.json`` (see :mod:`duplicates`) precisely so that this can stay true:
    two jobs sharing one file meant neither could clear its own findings without
    reasoning about the other's, and the issue resolver could delete both at once.
    """
    capped = normalize_issue_fixes(fixes)
    issue_path = issue_file_path(media_path)

    if not capped:
        if issue_path.is_file():
            issue_path.unlink()
        return

    issue_path.write_text(
        json.dumps({"fixes": capped}, indent=2) + "\n",
        encoding="utf-8",
    )
