"""Deleting to somewhere recoverable where the platform has one."""

from __future__ import annotations

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
