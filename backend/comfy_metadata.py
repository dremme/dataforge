from __future__ import annotations

import json
import struct
import threading
import zlib
from pathlib import Path

from constants import COMFY_WORKFLOW_EXTENSIONS

_MAX_COMFY_WORKFLOW_CACHE = 512
_comfy_workflow_cache: dict[str, tuple[tuple[int, int], bool]] = {}
_comfy_workflow_cache_lock = threading.Lock()

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_TEXT_CHUNK_TYPES = frozenset({b"tEXt", b"zTXt", b"iTXt", b"comf"})
_MAX_READ_BYTES = 64 * 1024 * 1024
_WORKFLOW_KEYS = frozenset(
    {
        "workflow",
        "Workflow",
        "WORKFLOW",
        "prompt",
        "Prompt",
        "PROMPT",
        "comment",
        "Comment",
        "COMMENT",
        "\xa9cmt",
    }
)


def _decode_text_chunk(chunk_type: bytes, chunk_data: bytes) -> tuple[str, str] | None:
    if chunk_type in {b"tEXt", b"comf"}:
        separator = chunk_data.find(b"\x00")
        if separator < 0:
            return None
        keyword = chunk_data[:separator].decode("latin1", errors="replace")
        text = chunk_data[separator + 1 :].decode("utf-8", errors="replace")
        return keyword, text

    if chunk_type == b"zTXt":
        separator = chunk_data.find(b"\x00")
        if separator < 0 or separator + 2 > len(chunk_data):
            return None
        keyword = chunk_data[:separator].decode("latin1", errors="replace")
        compression_method = chunk_data[separator + 1]
        if compression_method != 0:
            return None
        try:
            text = zlib.decompress(chunk_data[separator + 2 :]).decode("utf-8", errors="replace")
        except zlib.error:
            return None
        return keyword, text

    if chunk_type == b"iTXt":
        separator = chunk_data.find(b"\x00")
        if separator < 0 or separator + 2 > len(chunk_data):
            return None
        keyword = chunk_data[:separator].decode("latin1", errors="replace")
        is_compressed = chunk_data[separator + 1] == 1
        compression_method = chunk_data[separator + 2]
        cursor = separator + 3

        while cursor < len(chunk_data) and chunk_data[cursor] != 0:
            cursor += 1
        if cursor >= len(chunk_data):
            return None
        cursor += 1

        while cursor < len(chunk_data) and chunk_data[cursor] != 0:
            cursor += 1
        if cursor >= len(chunk_data):
            return None
        cursor += 1

        payload = chunk_data[cursor:]
        if is_compressed:
            if compression_method != 0:
                return None
            try:
                payload = zlib.decompress(payload)
            except zlib.error:
                return None

        text = payload.decode("utf-8", errors="replace")
        return keyword, text

    return None


def _parse_png_text_chunks(data: bytes) -> dict[str, str]:
    if len(data) < len(PNG_SIGNATURE) or data[: len(PNG_SIGNATURE)] != PNG_SIGNATURE:
        return {}

    offset = len(PNG_SIGNATURE)
    chunks: dict[str, str] = {}
    data_len = len(data)

    while offset + 12 <= data_len:
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_end = offset + 12 + length
        if chunk_end > data_len:
            break

        chunk_type = data[offset + 4 : offset + 8]
        chunk_data = data[offset + 8 : offset + 8 + length]

        if chunk_type in _TEXT_CHUNK_TYPES:
            decoded = _decode_text_chunk(chunk_type, chunk_data)
            if decoded is not None:
                keyword, text = decoded
                chunks[keyword] = text

        offset = chunk_end

    return chunks


def _read_u32(data: bytes, pos: int) -> int:
    if pos + 4 > len(data):
        return 0
    return struct.unpack(">I", data[pos : pos + 4])[0]


def _find_isobmff_box(data: bytes, start: int, end: int, box_type: bytes) -> tuple[int, int] | None:
    pos = start
    while pos + 8 <= end:
        size = _read_u32(data, pos)
        if size < 8:
            pos += 1
            continue

        if data[pos + 4 : pos + 8] == box_type:
            return pos + 8, pos + size

        if pos + size > end:
            return None

        pos += size

    return None


def _parse_keys_box(data: bytes, keys_start: int, keys_end: int) -> dict[int, str]:
    keys_map: dict[int, str] = {}
    pos = keys_start + 4
    if pos + 4 > keys_end:
        return keys_map

    entry_count = _read_u32(data, pos)
    pos += 4

    for index in range(1, entry_count + 1):
        if pos + 8 > keys_end:
            break

        key_size = _read_u32(data, pos)
        pos += 8
        key_name_end = pos + key_size - 8
        if key_size < 8 or key_name_end > keys_end:
            break

        key_name = data[pos:key_name_end].decode("utf-8", errors="replace")
        keys_map[index] = key_name
        pos = key_name_end

    return keys_map


def _read_isobmff_text_value(data: bytes, data_box: tuple[int, int]) -> str | None:
    value_start = data_box[0] + 8
    if value_start >= data_box[1]:
        return None

    raw = data[value_start : data_box[1]]
    if not raw:
        return None

    json_start = 0
    while json_start < len(raw) and raw[json_start] != ord("{"):
        json_start += 1
    if json_start < len(raw):
        raw = raw[json_start:]

    text = raw.decode("utf-8", errors="replace").strip()
    return text or None


def _store_metadata_value(metadata: dict[str, str], key_name: str, raw: str) -> None:
    metadata[key_name] = raw
    if key_name == "\xa9cmt":
        metadata["comment"] = raw


def _parse_indexed_ilst_item(
    data: bytes,
    item_start: int,
    item_end: int,
    keys_map: dict[int, str],
    metadata: dict[str, str],
) -> None:
    if item_start + 8 > item_end:
        return

    item_index = _read_u32(data, item_start + 4)
    key_name = keys_map.get(item_index)
    if not key_name:
        return

    data_box = _find_isobmff_box(data, item_start + 8, item_end, b"data")
    if not data_box:
        return

    text = _read_isobmff_text_value(data, data_box)
    if text:
        _store_metadata_value(metadata, key_name, text)


def _parse_indexed_ilst_box(
    data: bytes,
    ilst_start: int,
    ilst_end: int,
    keys_map: dict[int, str],
    metadata: dict[str, str],
) -> None:
    pos = ilst_start
    while pos + 8 <= ilst_end:
        item_size = _read_u32(data, pos)
        if item_size < 8 or pos + item_size > ilst_end:
            break
        _parse_indexed_ilst_item(data, pos, pos + item_size, keys_map, metadata)
        pos += item_size


def _parse_classic_ilst_item(
    data: bytes,
    item_start: int,
    item_end: int,
    metadata: dict[str, str],
) -> None:
    if item_start + 8 > item_end:
        return

    key_name = data[item_start + 4 : item_start + 8].decode("latin1", errors="replace")
    data_box = _find_isobmff_box(data, item_start + 8, item_end, b"data")
    if not data_box:
        return

    text = _read_isobmff_text_value(data, data_box)
    if text:
        _store_metadata_value(metadata, key_name, text)


def _parse_classic_ilst_box(
    data: bytes,
    ilst_start: int,
    ilst_end: int,
    metadata: dict[str, str],
) -> None:
    pos = ilst_start
    while pos + 8 <= ilst_end:
        item_size = _read_u32(data, pos)
        if item_size < 8 or pos + item_size > ilst_end:
            break
        _parse_classic_ilst_item(data, pos, pos + item_size, metadata)
        pos += item_size


def _parse_isobmff_metadata(data: bytes) -> dict[str, str]:
    metadata: dict[str, str] = {}

    user_data = _find_isobmff_box(data, 0, len(data), b"udta")
    if not user_data:
        moov = _find_isobmff_box(data, 0, len(data), b"moov")
        if moov:
            user_data = _find_isobmff_box(data, moov[0], moov[1], b"udta")

    if not user_data:
        return metadata

    meta_box = _find_isobmff_box(data, user_data[0], user_data[1], b"meta")
    if not meta_box:
        return metadata

    meta_content_start = meta_box[0] + 4
    ilst_box = _find_isobmff_box(data, meta_content_start, meta_box[1], b"ilst")
    if not ilst_box:
        return metadata

    keys_box = _find_isobmff_box(data, meta_content_start, meta_box[1], b"keys")
    if keys_box:
        keys_map = _parse_keys_box(data, keys_box[0], keys_box[1])
        if keys_map:
            _parse_indexed_ilst_box(data, ilst_box[0], ilst_box[1], keys_map, metadata)
            return metadata

    _parse_classic_ilst_box(data, ilst_box[0], ilst_box[1], metadata)
    return metadata


def _is_comfy_ui_workflow_json(value: object) -> bool:
    if not isinstance(value, dict):
        return False

    if "nodes" in value or "last_node_id" in value:
        return True

    if not value:
        return False

    return any(isinstance(entry, dict) and "class_type" in entry for entry in value.values())


def _json_value_has_comfy_workflow(value: object) -> bool:
    if _is_comfy_ui_workflow_json(value):
        return True

    if not isinstance(value, dict):
        return False

    for key in ("workflow", "Workflow", "WORKFLOW", "prompt", "Prompt", "PROMPT"):
        nested = value.get(key)
        if isinstance(nested, str):
            try:
                nested = json.loads(nested)
            except json.JSONDecodeError:
                continue
        if _is_comfy_ui_workflow_json(nested):
            return True

    return False


def _raw_text_has_comfy_workflow(raw: str) -> bool:
    if not raw:
        return False

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return False

    return _json_value_has_comfy_workflow(parsed)


def _metadata_values_have_comfy_workflow(values: dict[str, str]) -> bool:
    for key, raw in values.items():
        if (key in _WORKFLOW_KEYS or key.lower() in {"workflow", "prompt", "comment"}) and (
            _raw_text_has_comfy_workflow(raw)
        ):
            return True
    return False


def _read_media_bytes(file_path: Path) -> bytes:
    try:
        size = file_path.stat().st_size
        with file_path.open("rb") as handle:
            if size <= _MAX_READ_BYTES:
                return handle.read()

            if file_path.suffix.lower() == ".png":
                return handle.read(_MAX_READ_BYTES)

            # ComfyUI/ffmpeg MP4s usually place the moov atom at the end of the file.
            handle.seek(max(0, size - _MAX_READ_BYTES))
            return handle.read()
    except OSError:
        return b""


def clear_comfy_workflow_cache_for_tests() -> None:
    with _comfy_workflow_cache_lock:
        _comfy_workflow_cache.clear()


def _comfy_workflow_cache_token(file_path: Path) -> tuple[int, int] | None:
    try:
        stat = file_path.stat()
        return stat.st_mtime_ns, stat.st_size
    except OSError:
        return None


def read_media_metadata_values(file_path: Path) -> dict[str, str]:
    suffix = file_path.suffix.lower()
    if suffix not in COMFY_WORKFLOW_EXTENSIONS:
        return {}

    data = _read_media_bytes(file_path)
    if not data:
        return {}

    if suffix == ".png":
        return _parse_png_text_chunks(data)

    return _parse_isobmff_metadata(data)


def _probe_comfy_workflow(file_path: Path) -> bool:
    return _metadata_values_have_comfy_workflow(read_media_metadata_values(file_path))


def media_has_comfy_workflow(file_path: Path) -> bool:
    resolved = str(file_path.resolve())
    token = _comfy_workflow_cache_token(file_path)
    if token is not None:
        with _comfy_workflow_cache_lock:
            cached = _comfy_workflow_cache.get(resolved)
            if cached is not None and cached[0] == token:
                return cached[1]

    result = _probe_comfy_workflow(file_path)

    if token is not None:
        with _comfy_workflow_cache_lock:
            if len(_comfy_workflow_cache) >= _MAX_COMFY_WORKFLOW_CACHE:
                _comfy_workflow_cache.clear()
            _comfy_workflow_cache[resolved] = (token, result)

    return result
