"""Serve media bytes without leaving Windows delete-locks behind.

Starlette's ``FileResponse`` opens files with Python's default share mode, which
on Windows omits ``FILE_SHARE_DELETE``. An HTML5 ``<video>`` (or a cancelled
range request) can then keep the source locked with WinError 32 long after the
client has moved on: the ASGI send loop keeps the handle open while it drains
into a half-closed socket.

Two mitigations live here:

1. Open with ``FILE_SHARE_DELETE`` so delete/rename can succeed while a stream is
   still open (Windows only; POSIX already allows unlinking open files).
2. Cancel the stream as soon as ASGI reports ``http.disconnect``, so the handle
   is released instead of reading the rest of a multi-megabyte file into a dead
   connection.

What this does not buy: ``MoveFileEx`` still wants exclusive access to a file it
is *replacing*, so ``os.replace`` onto a path being streamed remains WinError 5
however the open handle shares. Moving or renaming the open file itself is fine,
which is the direction the gallery actually takes.

Only the three ``_handle_*`` body loops are overridden — everything else
(range parsing, 400/416 answers, headers) stays Starlette's. Those loops are
its own, with ``anyio.open_file`` swapped for :func:`async_open_shared_read`.
The pin on ``starlette`` in ``requirements.txt`` exists because of that
coupling; ``test_media_file_response.py`` guards the method signatures.
"""

from __future__ import annotations

import os
import secrets
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import BinaryIO

import anyio
from starlette.responses import FileResponse
from starlette.types import Receive, Scope, Send

if sys.platform == "win32":
    import ctypes
    import msvcrt
    from ctypes import wintypes

    _GENERIC_READ = 0x80000000
    _FILE_SHARE_READ = 0x00000001
    _FILE_SHARE_WRITE = 0x00000002
    _FILE_SHARE_DELETE = 0x00000004
    _OPEN_EXISTING = 3
    # Sequential scan tells the cache manager not to retain a whole video.
    _FILE_FLAG_SEQUENTIAL_SCAN = 0x08000000
    _INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value

    # Bound once at import: opens run concurrently on the thread pool, and
    # rebuilding the WinDLL and its argtypes per call was pure overhead.
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    _kernel32.CreateFileW.restype = wintypes.HANDLE
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel32.CloseHandle.restype = wintypes.BOOL


def open_shared_read(path: str | os.PathLike[str]) -> BinaryIO:
    """Open ``path`` for reading without blocking delete/rename on Windows."""
    if sys.platform != "win32":
        return open(path, "rb")

    handle = _kernel32.CreateFileW(
        os.fspath(path),
        _GENERIC_READ,
        _FILE_SHARE_READ | _FILE_SHARE_WRITE | _FILE_SHARE_DELETE,
        None,
        _OPEN_EXISTING,
        _FILE_FLAG_SEQUENTIAL_SCAN,
        None,
    )
    if handle == _INVALID_HANDLE_VALUE:
        # WinError maps the code to the right OSError subclass, so a file that
        # vanished mid-request still raises FileNotFoundError.
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        fd = msvcrt.open_osfhandle(int(handle), os.O_RDONLY)
    except OSError:
        # open_osfhandle did not take ownership, so the handle is still ours.
        _kernel32.CloseHandle(handle)
        raise

    try:
        return os.fdopen(fd, "rb")
    except OSError:
        # The fd owns the handle now; closing it closes both.
        os.close(fd)
        raise


@asynccontextmanager
async def async_open_shared_read(path: str | os.PathLike[str]) -> AsyncIterator[BinaryIO]:
    file = await anyio.to_thread.run_sync(open_shared_read, path)
    try:
        yield file
    finally:
        # Disconnect cancels the stream task; shield so the OS handle always closes.
        with anyio.CancelScope(shield=True):
            await anyio.to_thread.run_sync(file.close)


async def _read(file: BinaryIO, size: int) -> bytes:
    return await anyio.to_thread.run_sync(file.read, size)


async def _seek(file: BinaryIO, position: int) -> None:
    await anyio.to_thread.run_sync(file.seek, position)


async def _watch_disconnect(receive: Receive, cancel_scope: anyio.CancelScope) -> None:
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            cancel_scope.cancel()
            return


class MediaFileResponse(FileResponse):
    """``FileResponse`` that releases Windows delete-locks and stops on disconnect."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            async with anyio.create_task_group() as task_group:
                task_group.start_soon(_watch_disconnect, receive, task_group.cancel_scope)
                try:
                    await super().__call__(scope, receive, send)
                finally:
                    # Body finished (or failed) — stop waiting for a disconnect
                    # that will not come, which would hang the task group.
                    task_group.cancel_scope.cancel()
        except BaseExceptionGroup as group:
            # A task group always wraps, even a lone exception. Unwrap so callers
            # still see the RuntimeError Starlette raises for a vanished file.
            if len(group.exceptions) == 1:
                raise group.exceptions[0] from None
            raise

    async def _handle_simple(self, send: Send, send_header_only: bool) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": self.status_code,
                "headers": self.raw_headers,
            }
        )
        if send_header_only:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        async with async_open_shared_read(self.path) as file:
            more_body = True
            while more_body:
                chunk = await _read(file, self.chunk_size)
                more_body = len(chunk) == self.chunk_size
                await send({"type": "http.response.body", "body": chunk, "more_body": more_body})

    async def _handle_single_range(
        self,
        send: Send,
        start: int,
        end: int,
        file_size: int,
        send_header_only: bool,
    ) -> None:
        self.headers["content-range"] = f"bytes {start}-{end - 1}/{file_size}"
        self.headers["content-length"] = str(end - start)
        await send(
            {
                "type": "http.response.start",
                "status": 206,
                "headers": self.raw_headers,
            }
        )
        if send_header_only:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        async with async_open_shared_read(self.path) as file:
            await _seek(file, start)
            more_body = True
            position = start
            while more_body:
                chunk = await _read(file, min(self.chunk_size, end - position))
                position += len(chunk)
                more_body = len(chunk) == self.chunk_size and position < end
                await send({"type": "http.response.body", "body": chunk, "more_body": more_body})

    async def _handle_multiple_ranges(
        self,
        send: Send,
        ranges: list[tuple[int, int]],
        file_size: int,
        send_header_only: bool,
    ) -> None:
        # 13 bytes matches the entropy Firefox and Chrome use for boundaries.
        boundary = secrets.token_hex(13)
        content_length, header_generator = self.generate_multipart(
            ranges, boundary, file_size, self.headers["content-type"]
        )
        self.headers["content-range"] = f"multipart/byteranges; boundary={boundary}"
        self.headers["content-length"] = str(content_length)
        await send(
            {
                "type": "http.response.start",
                "status": 206,
                "headers": self.raw_headers,
            }
        )
        if send_header_only:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        async with async_open_shared_read(self.path) as file:
            for start, end in ranges:
                await send(
                    {
                        "type": "http.response.body",
                        "body": header_generator(start, end),
                        "more_body": True,
                    }
                )
                await _seek(file, start)
                position = start
                while position < end:
                    chunk = await _read(file, min(self.chunk_size, end - position))
                    position += len(chunk)
                    await send({"type": "http.response.body", "body": chunk, "more_body": True})
                await send({"type": "http.response.body", "body": b"\n", "more_body": True})
            await send(
                {
                    "type": "http.response.body",
                    "body": f"\n--{boundary}--\n".encode("latin-1"),
                    "more_body": False,
                }
            )
