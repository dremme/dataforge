"""Deleting to somewhere recoverable where the platform has one."""

from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _FO_DELETE = 0x0003
    _FOF_SILENT = 0x0004
    _FOF_NOCONFIRMATION = 0x0010
    _FOF_ALLOWUNDO = 0x0040
    _FOF_NOERRORUI = 0x0400

    class _SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    _shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    _shell32.SHFileOperationW.argtypes = [ctypes.POINTER(_SHFILEOPSTRUCTW)]
    _shell32.SHFileOperationW.restype = ctypes.c_int


def _send_to_recycle_bin(path: Path) -> None:
    """Move ``path`` to the Windows Recycle Bin (FOF_ALLOWUNDO)."""
    # PCZZWSTR entries are null-terminated; a trailing "\0" yields the double-null terminator.
    absolute = str(path.resolve(strict=False))
    from_buffer = ctypes.create_unicode_buffer(absolute + "\0")

    file_op = _SHFILEOPSTRUCTW()
    file_op.wFunc = _FO_DELETE
    file_op.pFrom = ctypes.cast(from_buffer, wintypes.LPCWSTR)
    file_op.fFlags = _FOF_ALLOWUNDO | _FOF_NOCONFIRMATION | _FOF_SILENT | _FOF_NOERRORUI

    result = _shell32.SHFileOperationW(ctypes.byref(file_op))
    if (result != 0 or file_op.fAnyOperationsAborted) and path.exists():
        raise OSError(
            f"Failed to move {path.name} to the Recycle Bin (error {result})",
        )


def delete_path(path: Path) -> None:
    """Recycle Bin on Windows, permanent unlink elsewhere."""
    if sys.platform == "win32":
        _send_to_recycle_bin(path)
        return
    path.unlink()


def delete_empty_dir(path: Path) -> None:
    """Like :func:`delete_path`; elsewhere ``rmdir`` refuses a folder that gained an entry."""
    if sys.platform == "win32":
        _send_to_recycle_bin(path)
        return
    path.rmdir()


def deletes_to_trash() -> bool:
    """Whether :func:`delete_path` puts a file somewhere it can be recovered from."""
    return sys.platform == "win32"


# A recycled file is a `$R…` data file beside a `$I…` record of where it came from:
# version (int64), size (int64), deletion FILETIME (int64), then the original path in UTF-16.
# Version 1 (Vista to 8.1) stores the path in a fixed 260-character field; version 2 (10 and
# later) prefixes it with its length in characters, terminator included.
_RECYCLE_HEADER = struct.Struct("<qqq")
_RECYCLE_V1_PATH_CHARS = 260


def parse_recycle_record(data: bytes) -> tuple[str, int] | None:
    """The original path and deletion time of a `$I` record, or ``None`` if it is not one."""
    if len(data) < _RECYCLE_HEADER.size:
        return None
    version, _size, deleted_at = _RECYCLE_HEADER.unpack_from(data)
    offset = _RECYCLE_HEADER.size
    if version == 1:
        raw = data[offset : offset + 2 * _RECYCLE_V1_PATH_CHARS]
    elif version == 2 and len(data) >= offset + 4:
        (chars,) = struct.unpack_from("<i", data, offset)
        raw = data[offset + 4 : offset + 4 + 2 * chars]
    else:
        return None
    path = raw.decode("utf-16-le", errors="replace").split("\0", 1)[0]
    return (path, deleted_at) if path else None


def _recycled_copies(original: Path) -> list[tuple[int, Path]]:
    """Every `$I` record for ``original`` in its drive's Recycle Bin, as (deleted_at, record)."""
    root = Path(original.anchor) / "$Recycle.Bin"
    wanted = os.path.normcase(str(original))
    found: list[tuple[int, Path]] = []
    try:
        # One folder per user SID; other users' folders refuse a listing, which is fine.
        bins = [entry for entry in root.iterdir() if entry.is_dir()]
    except OSError:
        return found
    for bin_dir in bins:
        try:
            records = list(bin_dir.glob("$I*"))
        except OSError:
            continue
        for record in records:
            try:
                parsed = parse_recycle_record(record.read_bytes())
            except OSError:
                continue
            if parsed and os.path.normcase(parsed[0]) == wanted:
                found.append((parsed[1], record))
    return found


def restore_from_trash(original: Path) -> bool:
    """Put the newest recycled copy of ``original`` back; ``False`` when the bin has none.

    Raises :class:`FileExistsError` when something already took the name, since restoring over
    it would destroy that file.
    """
    if not deletes_to_trash():
        return False
    for _deleted_at, record in sorted(_recycled_copies(original), reverse=True):
        data = record.with_name("$R" + record.name[2:])
        if not data.exists():
            continue
        if original.exists():
            raise FileExistsError(f"{original.name} already exists")
        os.replace(data, original)
        record.unlink(missing_ok=True)
        return True
    return False
