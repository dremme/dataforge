"""Shared helpers for backend API tests."""

from __future__ import annotations

import atexit
import json
import os
import struct
import tempfile
from pathlib import Path

_test_database_dir: tempfile.TemporaryDirectory[str] | None = None


def _cleanup_test_database() -> None:
    global _test_database_dir

    if _test_database_dir is None:
        return

    from db import close_all_connections

    close_all_connections()
    _test_database_dir.cleanup()
    _test_database_dir = None


def isolate_test_database() -> Path:
    """Point the backend at a temporary SQLite file for tests.

    Call this before importing modules that read or write preferences.
    Also disables project ``.env`` loading so developer machine config cannot
    leak into assertions.
    """
    global _test_database_dir

    # Must be set before any import of main / env_file load runs.
    os.environ["DATAFORGE_DISABLE_DOTENV"] = "1"

    if _test_database_dir is None:
        _test_database_dir = tempfile.TemporaryDirectory(prefix="dataforge-test-db-")
        db_path = Path(_test_database_dir.name) / "test.db"
        os.environ["DATAFORGE_DB_PATH"] = str(db_path)
        from db import init_db

        init_db()
        atexit.register(_cleanup_test_database)

    return Path(os.environ["DATAFORGE_DB_PATH"])


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    import zlib

    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def _png_text_chunk(keyword: str, text: str) -> bytes:
    payload = keyword.encode("latin1") + b"\x00" + text.encode("utf-8")
    return _png_chunk(b"tEXt", payload)


def _png_ztxt_chunk(keyword: str, text: str) -> bytes:
    import zlib

    compressed = zlib.compress(text.encode("utf-8"))
    payload = keyword.encode("latin1") + b"\x00\x00" + compressed
    return _png_chunk(b"zTXt", payload)


def make_png_bytes(
    width: int = 64,
    height: int = 48,
    *,
    text_chunks: dict[str, str] | None = None,
) -> bytes:
    import zlib

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw_row = b"\x00" + b"\x00" * (width * 3)
    idat = zlib.compress(raw_row * height)

    parts = [PNG_SIGNATURE, _png_chunk(b"IHDR", ihdr)]
    for keyword, text in (text_chunks or {}).items():
        parts.append(_png_text_chunk(keyword, text))
    parts.extend([_png_chunk(b"IDAT", idat), _png_chunk(b"IEND", b"")])
    return b"".join(parts)


def make_png_ztxt_bytes(
    width: int = 64,
    height: int = 48,
    *,
    text_chunks: dict[str, str] | None = None,
) -> bytes:
    import zlib

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw_row = b"\x00" + b"\x00" * (width * 3)
    idat = zlib.compress(raw_row * height)

    parts = [PNG_SIGNATURE, _png_chunk(b"IHDR", ihdr)]
    for keyword, text in (text_chunks or {}).items():
        parts.append(_png_ztxt_chunk(keyword, text))
    parts.extend([_png_chunk(b"IDAT", idat), _png_chunk(b"IEND", b"")])
    return b"".join(parts)


def write_media(
    root: Path,
    name: str = "photo.png",
    *,
    width: int = 64,
    height: int = 48,
    text_chunks: dict[str, str] | None = None,
) -> Path:
    media = root / name
    media.write_bytes(make_png_bytes(width, height, text_chunks=text_chunks))
    return media


def _mp4_full_box(box_type: str, version: int, payload: bytes) -> bytes:
    body = bytes([version, 0, 0, 0]) + payload
    return struct.pack(">I4s", 8 + len(body), box_type.encode("latin1")) + body


def _mp4_box(box_type: str, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), box_type.encode("latin1")) + payload


def _mp4_udta_meta_classic(metadata: dict[str, str]) -> bytes:
    ilst_body = b""
    for key, value in metadata.items():
        key_bytes = key.encode("latin1") if isinstance(key, str) else key
        data_box = _mp4_full_box("data", 0, b"\x00\x00\x00\x01" + value.encode("utf-8"))
        item_payload = key_bytes + data_box
        ilst_body += struct.pack(">I", 4 + len(item_payload)) + item_payload

    ilst_box = _mp4_box("ilst", ilst_body)
    hdlr = _mp4_full_box(
        "hdlr",
        0,
        b"\x00\x00\x00\x00" + b"mdir" + b"\x00" * 12 + b"appl\x00",
    )
    meta_box = _mp4_full_box("meta", 0, hdlr + ilst_box)
    return _mp4_box("udta", meta_box)


def _mp4_udta_meta(metadata: dict[str, str]) -> bytes:
    keys_body = struct.pack(">I", len(metadata))
    for key, _value in metadata.items():
        key_bytes = key.encode("utf-8")
        entry_size = 8 + len(key_bytes)
        keys_body += struct.pack(">I4s", entry_size, b"mdta") + key_bytes

    keys_box = _mp4_full_box("keys", 0, keys_body)

    ilst_body = b""
    for index, value in enumerate(metadata.values(), start=1):
        data_box = _mp4_full_box("data", 0, b"\x00\x00\x00\x00" + value.encode("utf-8"))
        item_payload = struct.pack(">I", index) + data_box
        ilst_body += struct.pack(">I", 4 + len(item_payload)) + item_payload

    ilst_box = _mp4_box("ilst", ilst_body)
    hdlr = _mp4_full_box(
        "hdlr",
        0,
        b"\x00\x00\x00\x00" + b"mdta" + b"\x00" * 12 + b"Metadata\x00",
    )
    meta_box = _mp4_full_box("meta", 0, hdlr + keys_box + ilst_box)
    return _mp4_box("udta", meta_box)


def make_minimal_mp4_bytes(
    *,
    sample_count: int = 300,
    timescale: int = 30_000,
    sample_delta: int = 1_000,
    metadata: dict[str, str] | None = None,
    metadata_format: str = "indexed",
) -> bytes:
    def make_hdlr(handler_type: str) -> bytes:
        payload = b"\x00" * 4 + handler_type.encode("latin1") + b"\x00" * 12 + b"Handler\x00"
        return _mp4_full_box("hdlr", 0, payload)

    def make_mdhd(scale: int, duration: int) -> bytes:
        payload = struct.pack(">IIII", 0, 0, scale, duration) + b"\x55\xc4\x00\x00"
        return _mp4_full_box("mdhd", 0, payload)

    def make_stsz(count: int) -> bytes:
        payload = struct.pack(">II", 0, count)
        return _mp4_full_box("stsz", 0, payload)

    def make_stts(entries: list[tuple[int, int]]) -> bytes:
        payload = struct.pack(">I", len(entries))
        for count, delta in entries:
            payload += struct.pack(">II", count, delta)
        return _mp4_full_box("stts", 0, payload)

    stbl = _mp4_box("stbl", make_stsz(sample_count) + make_stts([(sample_count, sample_delta)]))
    minf = _mp4_box("minf", stbl)
    mdia = make_hdlr("vide") + make_mdhd(timescale, sample_count * sample_delta) + minf
    trak = _mp4_box("trak", mdia)
    moov_children = [trak]
    if metadata:
        if metadata_format == "classic":
            moov_children.append(_mp4_udta_meta_classic(metadata))
        else:
            moov_children.append(_mp4_udta_meta(metadata))
    moov = _mp4_box("moov", b"".join(moov_children))
    return _mp4_box("ftyp", b"isom\x00\x00\x02\x00isomiso2mp41") + moov


def write_mp4_video(
    root: Path,
    name: str = "clip.mp4",
    *,
    sample_count: int = 300,
    timescale: int = 30_000,
    sample_delta: int = 1_000,
    metadata: dict[str, str] | None = None,
    metadata_format: str = "indexed",
) -> Path:
    media = root / name
    media.write_bytes(
        make_minimal_mp4_bytes(
            sample_count=sample_count,
            timescale=timescale,
            sample_delta=sample_delta,
            metadata=metadata,
            metadata_format=metadata_format,
        ),
    )
    return media


def write_txt_caption(media: Path, text: str) -> Path:
    caption = media.with_suffix(".txt")
    caption.write_text(text, encoding="utf-8")
    return caption


def write_json_caption(media: Path, data: object) -> Path:
    caption = media.with_suffix(".json")
    caption.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return caption


def write_sysprompt(folder: Path, text: str) -> Path:
    from constants import SYSPROMPT_FILENAME

    sysprompt = folder / SYSPROMPT_FILENAME
    sysprompt.write_text(text, encoding="utf-8")
    return sysprompt


class TempMediaFolder:
    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def __enter__(self) -> Path:
        return self.root

    def __exit__(self, *args: object) -> None:
        self._tmp.cleanup()


def reset_job_manager() -> None:
    """Cancel active work and clear in-memory + SQLite job state between tests.

    Only wiping memory left persisted ``running``/``queued`` rows visible to
    ``list_jobs`` (active_count flakiness). Clearing ``_deleted_ids`` also let
    finishing worker threads re-save jobs after a test thought they were gone.
    """
    from automation.jobs import job_manager

    job_manager.delete_all_jobs()


def wait_for_job(job_id: str, *, timeout: float = 5.0):
    """Poll until a background job reaches a terminal status in memory and store.

    Store and memory are updated under the same lock, but wait until the
    persisted row matches so tests that read SQLite never race a lagging write.
    """
    import time

    from automation.jobs import ACTIVE_STATUSES, job_manager
    from automation.jobs_store import get_job as get_job_from_store

    deadline = time.time() + timeout
    while time.time() < deadline:
        job = job_manager.get_job(job_id)
        if job is not None and job.status not in ACTIVE_STATUSES:
            stored = get_job_from_store(job_id)
            if stored is not None and stored.get("status") == job.status:
                return job
        time.sleep(0.05)

    job = job_manager.get_job(job_id)
    status = job.status if job is not None else "missing"
    stored = get_job_from_store(job_id)
    stored_status = stored.get("status") if stored is not None else "missing"
    raise TimeoutError(
        f"Job {job_id} did not finish in time (memory={status}, store={stored_status})"
    )
