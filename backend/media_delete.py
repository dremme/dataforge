from __future__ import annotations

import logging
import sys
from pathlib import Path

from captions import issue_file_path
from constants import SIDECAR_EXTENSIONS
from duplicates import duplicate_file_path
from video_edit import backup_path_for, edit_spec_path

logger = logging.getLogger(__name__)

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
    # PCZZWSTR: path entries are null-terminated, list ends with an extra null.
    # create_unicode_buffer adds a trailing null; appending "\0" after the path
    # yields the required double-null terminator.
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
    """Remove a file: Recycle Bin on Windows, permanent unlink elsewhere."""
    if sys.platform == "win32":
        _send_to_recycle_bin(path)
        return
    path.unlink()


def deletes_to_trash() -> bool:
    """Whether :func:`delete_path` puts a file somewhere it can be recovered from.

    Reported to the UI so a flow that deletes without asking can ask where the
    deletion is final. Deliberately phrased as a capability rather than as
    "is Windows": adding a freedesktop trash implementation should flip this and
    silence the extra confirmation, with nothing in the frontend to change.

    Kept beside ``delete_path`` so the two cannot drift apart.
    """
    return sys.platform == "win32"


def delete_media_with_sidecars(file_path: Path) -> dict[str, object]:
    deleted: list[str] = []

    try:
        delete_path(file_path)
    except OSError as exc:
        raise OSError(f"Failed to delete {file_path.name}: {exc}") from exc

    deleted.append(file_path.name)

    for extension in SIDECAR_EXTENSIONS:
        sidecar = file_path.with_suffix(extension)
        if not sidecar.is_file():
            continue
        try:
            delete_path(sidecar)
            deleted.append(sidecar.name)
        except OSError as exc:
            logger.warning("Failed to delete sidecar %s: %s", sidecar.name, exc)

    # Named explicitly rather than folded into SIDECAR_EXTENSIONS: none of these is one
    # `with_suffix` away from the media name - the first two are two suffixes deep, and
    # the backup keeps the whole filename. Leaving the backup behind would litter the
    # folder with an original nothing can ever reach again.
    for extra in (
        issue_file_path(file_path),
        duplicate_file_path(file_path),
        backup_path_for(file_path),
        edit_spec_path(file_path),
    ):
        if not extra.is_file():
            continue
        try:
            delete_path(extra)
            deleted.append(extra.name)
        except OSError as exc:
            logger.warning("Failed to delete sidecar %s: %s", extra.name, exc)

    return {
        "path": str(file_path),
        "deleted": deleted,
    }
