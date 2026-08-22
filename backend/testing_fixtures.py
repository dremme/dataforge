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


def write_jpeg(
    root: Path,
    name: str = "photo.jpg",
    *,
    width: int = 64,
    height: int = 48,
    color: tuple[int, int, int] = (0, 0, 0),
    orientation: int | None = None,
) -> Path:
    """A real JPEG, optionally carrying an EXIF Orientation tag."""
    from PIL import Image

    media = root / name
    image = Image.new("RGB", (width, height), color)
    if orientation is None:
        image.save(media, format="JPEG")
        return media

    exif = Image.Exif()
    exif[0x0112] = orientation
    image.save(media, format="JPEG", exif=exif)
    return media


def write_image(
    root: Path,
    name: str,
    *,
    width: int = 64,
    height: int = 48,
    color: tuple[int, int, int] = (120, 90, 60),
) -> Path:
    """A real image in whatever format the name asks for, via Pillow's own suffix map."""
    from PIL import Image

    media = root / name
    Image.new("RGB", (width, height), color).save(media)
    return media


def write_gif(
    root: Path,
    name: str = "loop.gif",
    *,
    frames: int = 12,
    width: int = 64,
    height: int = 48,
    duration_ms: int = 100,
) -> Path:
    """An animated GIF whose frames are all visibly different.

    The moving block is not decoration: Pillow's GIF encoder merges frames that
    render identically and folds their delays together, so a fixture drawn from
    one repeated image silently writes a one-frame GIF.
    """
    from PIL import Image, ImageDraw

    images = []
    for index in range(frames):
        frame = Image.new("RGB", (width, height), (10, 10, 10))
        offset = (index * 5) % max(1, width - 16)
        ImageDraw.Draw(frame).rectangle(
            [offset, 4, offset + 15, height - 5],
            fill=(240 - index * 4, 30 + index * 6, 90),
        )
        images.append(frame.convert("P", palette=Image.Palette.ADAPTIVE))

    media = root / name
    images[0].save(
        media,
        save_all=True,
        append_images=images[1:],
        duration=duration_ms,
        loop=0,
    )
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


def _mp4_tkhd(width: int, height: int, *, version: int = 0) -> bytes:
    """A track header carrying a 16.16 fixed-point display size."""
    times = (
        struct.pack(">QQI4xQ", 0, 0, 1, 0) if version == 1 else struct.pack(">IIII4x", 0, 0, 1, 0)
    )
    unity_matrix = struct.pack(
        ">9i",
        0x10000,
        0,
        0,
        0,
        0x10000,
        0,
        0,
        0,
        0x40000000,
    )
    # reserved(8), layer(2), alternate_group(2), volume(2), reserved(2)
    payload = times + b"\x00" * 16 + unity_matrix + struct.pack(">II", width << 16, height << 16)
    return _mp4_full_box("tkhd", version, payload)


def make_minimal_mp4_bytes(
    *,
    sample_count: int = 300,
    timescale: int = 30_000,
    sample_delta: int = 1_000,
    metadata: dict[str, str] | None = None,
    metadata_format: str = "indexed",
    width: int = 640,
    height: int = 480,
    tkhd_version: int = 0,
    trailing_moov: bool = False,
) -> bytes:
    """A header-only MP4.

    ``trailing_moov`` puts the sample data in front of the header, the way many
    encoders write a file that was not prepared for streaming.
    """

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
    # Wrapped in a real `mdia` box rather than concatenated loose into `trak`:
    # that is where the spec puts these, and it is the nesting a reader meets.
    mdia = _mp4_box(
        "mdia",
        make_hdlr("vide") + make_mdhd(timescale, sample_count * sample_delta) + minf,
    )
    trak = _mp4_box("trak", _mp4_tkhd(width, height, version=tkhd_version) + mdia)
    moov_children = [trak]
    if metadata:
        if metadata_format == "classic":
            moov_children.append(_mp4_udta_meta_classic(metadata))
        else:
            moov_children.append(_mp4_udta_meta(metadata))
    moov = _mp4_box("moov", b"".join(moov_children))
    ftyp = _mp4_box("ftyp", b"isom\x00\x00\x02\x00isomiso2mp41")
    if trailing_moov:
        return ftyp + _mp4_box("mdat", b"\x00" * 4096) + moov
    return ftyp + moov


def write_mp4_video(
    root: Path,
    name: str = "clip.mp4",
    *,
    sample_count: int = 300,
    timescale: int = 30_000,
    sample_delta: int = 1_000,
    metadata: dict[str, str] | None = None,
    metadata_format: str = "indexed",
    width: int = 640,
    height: int = 480,
    tkhd_version: int = 0,
    trailing_moov: bool = False,
) -> Path:
    media = root / name
    media.write_bytes(
        make_minimal_mp4_bytes(
            sample_count=sample_count,
            timescale=timescale,
            sample_delta=sample_delta,
            metadata=metadata,
            metadata_format=metadata_format,
            width=width,
            height=height,
            tkhd_version=tkhd_version,
            trailing_moov=trailing_moov,
        ),
    )
    return media


def _ebml_id(element_id: int) -> bytes:
    """An element ID is emitted exactly as written: its marker bit is part of it."""
    return element_id.to_bytes((element_id.bit_length() + 7) // 8, "big")


def _ebml_size(value: int) -> bytes:
    """The shortest size vint that holds ``value`` without reading as "unknown"."""
    for length in range(1, 9):
        capacity = (1 << (7 * length)) - 1
        if value < capacity:
            return (value | (1 << (7 * length))).to_bytes(length, "big")
    raise ValueError(f"EBML size out of range: {value}")


def _ebml_element(element_id: int, payload: bytes) -> bytes:
    return _ebml_id(element_id) + _ebml_size(len(payload)) + payload


def _ebml_uint_element(element_id: int, value: int) -> bytes:
    width = max(1, (value.bit_length() + 7) // 8)
    return _ebml_element(element_id, value.to_bytes(width, "big"))


def _matroska_track(
    *,
    track_type: int,
    size: tuple[int, int] | None = None,
    display_size: tuple[int, int] | None = None,
    display_unit: int | None = None,
) -> bytes:
    entry = _ebml_uint_element(0x83, track_type)
    if size is None:
        return _ebml_element(0xAE, entry)

    video = _ebml_uint_element(0xB0, size[0]) + _ebml_uint_element(0xBA, size[1])
    if display_size is not None:
        video += _ebml_uint_element(0x54B0, display_size[0])
        video += _ebml_uint_element(0x54BA, display_size[1])
    if display_unit is not None:
        video += _ebml_uint_element(0x54B2, display_unit)

    return _ebml_element(0xAE, entry + _ebml_element(0xE0, video))


def make_minimal_matroska_bytes(
    *,
    width: int = 640,
    height: int = 480,
    duration_seconds: float | None = 12.5,
    timecode_scale: int = 1_000_000,
    duration_width: int = 8,
    display_size: tuple[int, int] | None = None,
    display_unit: int | None = None,
    audio_track: bool = True,
    second_video: tuple[int, int] | None = None,
    cluster_before_tracks: bool = False,
    unknown_segment_size: bool = False,
) -> bytes:
    """A header-only matroska file: one segment, no frames worth decoding.

    ``cluster_before_tracks`` puts sample data between the two elements the probe
    wants, so a reader that cannot seek over a cluster never reaches ``Tracks``.
    """
    info_children = _ebml_uint_element(0x2AD7B1, timecode_scale)
    if duration_seconds is not None:
        ticks = duration_seconds * 1_000_000_000 / timecode_scale
        info_children += _ebml_element(
            0x4489,
            struct.pack(">d" if duration_width == 8 else ">f", ticks),
        )
    info = _ebml_element(0x1549A966, info_children)

    entries = b""
    if audio_track:
        entries += _matroska_track(track_type=2)
    entries += _matroska_track(
        track_type=1,
        size=(width, height),
        display_size=display_size,
        display_unit=display_unit,
    )
    if second_video is not None:
        entries += _matroska_track(track_type=1, size=second_video)
    tracks = _ebml_element(0x1654AE6B, entries)

    cluster = _ebml_element(0x1F43B675, b"\x00" * 2048)
    body = info + (cluster + tracks if cluster_before_tracks else tracks + cluster)

    header = _ebml_element(0x1A45DFA3, _ebml_element(0x4282, b"matroska"))
    if unknown_segment_size:
        # What a muxer writes when it does not know the length up front.
        return header + _ebml_id(0x18538067) + b"\xff" + body
    return header + _ebml_element(0x18538067, body)


def write_matroska_video(
    root: Path,
    name: str = "clip.mkv",
    **kwargs: object,
) -> Path:
    media = root / name
    media.write_bytes(make_minimal_matroska_bytes(**kwargs))  # type: ignore[arg-type]
    return media


def write_txt_caption(media: Path, text: str) -> Path:
    caption = media.with_suffix(".txt")
    caption.write_text(text, encoding="utf-8")
    return caption


def write_json_caption(media: Path, data: object) -> Path:
    caption = media.with_suffix(".json")
    caption.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return caption


def write_issue_sidecar(media: Path, *fixes: str) -> Path:
    from captions import issue_file_path

    issue_path = issue_file_path(media)
    issue_path.write_text(
        json.dumps({"fixes": list(fixes)}, indent=2) + "\n",
        encoding="utf-8",
    )
    return issue_path


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
