from __future__ import annotations

import inspect
import os
import sys
import unittest

import anyio
from starlette.responses import FileResponse

from media_file_response import MediaFileResponse, open_shared_read
from testing_fixtures import TempMediaFolder, write_media, write_mp4_video


def _asgi_scope(headers: list[tuple[bytes, bytes]] | None = None, method: str = "GET") -> dict:
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": "/api/media",
        "raw_path": b"/api/media",
        "query_string": b"",
        "headers": headers or [],
        "client": ("127.0.0.1", 123),
        "server": ("127.0.0.1", 80),
    }


async def _park() -> dict:
    """A ``receive`` that never reports a disconnect."""
    await anyio.sleep_forever()
    return {"type": "http.disconnect"}


class _Recorder:
    """Collects an ASGI response so tests can assert on status, headers, and body."""

    def __init__(self) -> None:
        self.status: int | None = None
        self.headers: dict[str, str] = {}
        self.chunks: list[bytes] = []
        self.body_sends = 0

    async def __call__(self, message: dict) -> None:
        if message["type"] == "http.response.start":
            self.status = message["status"]
            self.headers = {
                key.decode("latin-1").lower(): value.decode("latin-1")
                for key, value in message.get("headers", [])
            }
        elif message["type"] == "http.response.body":
            self.body_sends += 1
            self.chunks.append(message.get("body", b""))

    @property
    def body(self) -> bytes:
        return b"".join(self.chunks)


def _serve(response: MediaFileResponse, scope: dict, receive=_park) -> _Recorder:
    recorder = _Recorder()

    async def run() -> None:
        await response(scope, receive, recorder)

    anyio.run(run)
    return recorder


class OpenSharedReadTests(unittest.TestCase):
    def test_reads_file_bytes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            expected = media.read_bytes()

            with open_shared_read(media) as handle:
                self.assertEqual(handle.read(), expected)

    def test_missing_file_raises_file_not_found(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaises(FileNotFoundError):
                open_shared_read(root / "not-here.png")

    @unittest.skipUnless(sys.platform == "win32", "FILE_SHARE_DELETE is a Windows concern")
    def test_allows_delete_while_handle_is_open(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with open_shared_read(media) as handle:
                handle.read(1)
                # Default open() would raise WinError 32 here.
                media.unlink()
                self.assertFalse(media.exists())

    @unittest.skipUnless(sys.platform == "win32", "FILE_SHARE_DELETE is a Windows concern")
    def test_allows_rename_while_handle_is_open(self) -> None:
        """Mirrors automation/rename_media.py, which renames media in place."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            renamed = root / "sunrise.png"

            with open_shared_read(media) as handle:
                handle.read(1)
                media.rename(renamed)

            self.assertTrue(renamed.exists())
            self.assertFalse(media.exists())

    @unittest.skipUnless(sys.platform == "win32", "FILE_SHARE_DELETE is a Windows concern")
    def test_allows_moving_an_open_file_away(self) -> None:
        """Mirrors media_transfer.py:94 — the gallery streams a file as it is moved."""
        with TempMediaFolder() as root:
            source = write_media(root, "sunset.png")
            destination = root / "moved.png"
            expected = source.read_bytes()

            with open_shared_read(source) as handle:
                handle.read(1)
                os.replace(source, destination)

            self.assertEqual(destination.read_bytes(), expected)
            self.assertFalse(source.exists())

    @unittest.skipUnless(sys.platform == "win32", "FILE_SHARE_DELETE is a Windows concern")
    def test_replacing_an_open_destination_still_fails(self) -> None:
        """``os.replace`` onto a streamed destination still fails with WinError 5."""
        with TempMediaFolder() as root:
            destination = write_media(root, "sunset.png")
            source = write_media(root, "other.png", width=32, height=32)

            with open_shared_read(destination) as handle:
                handle.read(1)
                with self.assertRaises(OSError) as raised:
                    os.replace(source, destination)
                self.assertEqual(raised.exception.winerror, 5)

    @unittest.skipUnless(sys.platform == "win32", "FILE_SHARE_DELETE is a Windows concern")
    def test_default_open_blocks_delete_while_handle_is_open(self) -> None:
        """Document why MediaFileResponse cannot use plain open() on Windows."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            with media.open("rb") as handle:
                handle.read(1)
                with self.assertRaises(OSError) as raised:
                    media.unlink()
                self.assertEqual(raised.exception.winerror, 32)


class MediaFileResponseTests(unittest.TestCase):
    def test_serves_full_body(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            expected = media.read_bytes()

            recorder = _serve(MediaFileResponse(media), _asgi_scope())

            self.assertEqual(recorder.status, 200)
            self.assertEqual(recorder.body, expected)

    def test_head_sends_no_body(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            recorder = _serve(MediaFileResponse(media), _asgi_scope(method="HEAD"))

            self.assertEqual(recorder.status, 200)
            self.assertEqual(recorder.body, b"")

    def test_stops_streaming_on_disconnect(self) -> None:
        with TempMediaFolder() as root:
            # Large enough that a cancel mid-stream is observable.
            media = root / "big.bin"
            total_chunks = 8
            media.write_bytes(os.urandom(MediaFileResponse.chunk_size * total_chunks))

            response = MediaFileResponse(media)
            recorder = _Recorder()
            disconnect_after = 2

            async def receive() -> dict:
                # Wait until a few body chunks have gone out, then report disconnect.
                while recorder.body_sends < disconnect_after:
                    await anyio.sleep(0)
                return {"type": "http.disconnect"}

            async def send(message: dict) -> None:
                await recorder(message)
                # Give the disconnect watcher a chance to run between chunks.
                await anyio.sleep(0)

            async def run() -> None:
                await response(_asgi_scope(), receive, send)

            anyio.run(run)

            # Stopped near the disconnect rather than draining the whole file.
            self.assertGreaterEqual(recorder.body_sends, disconnect_after)
            self.assertLess(recorder.body_sends, total_chunks)

    def test_external_cancellation_propagates(self) -> None:
        """Server shutdown must not be swallowed as a normal response."""
        with TempMediaFolder() as root:
            media = root / "big.bin"
            media.write_bytes(os.urandom(MediaFileResponse.chunk_size * 8))
            response = MediaFileResponse(media)
            recorder = _Recorder()
            cancelled = False

            async def send(message: dict) -> None:
                await recorder(message)
                await anyio.sleep(0)

            async def run() -> None:
                nonlocal cancelled
                with anyio.CancelScope() as scope:

                    async def cancel_soon() -> None:
                        while recorder.body_sends < 2:
                            await anyio.sleep(0)
                        scope.cancel()

                    async with anyio.create_task_group() as task_group:
                        task_group.start_soon(cancel_soon)
                        await response(_asgi_scope(), _park, send)
                cancelled = scope.cancel_called

            anyio.run(run)
            self.assertTrue(cancelled)

    def test_vanished_file_raises_runtime_error_not_group(self) -> None:
        """The task group wraps every exception; MediaFileResponse must unwrap."""
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")
            response = MediaFileResponse(media)
            media.unlink()

            with self.assertRaises(RuntimeError):
                _serve(response, _asgi_scope())

    @unittest.skipUnless(sys.platform == "win32", "FILE_SHARE_DELETE is a Windows concern")
    def test_source_can_be_deleted_while_response_is_open(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root)
            response = MediaFileResponse(media)
            deleted = False

            async def send(message: dict) -> None:
                nonlocal deleted
                if message["type"] == "http.response.body" and not deleted:
                    media.unlink()
                    deleted = True
                    self.assertFalse(media.exists())

            async def run() -> None:
                await response(_asgi_scope(), _park, send)

            anyio.run(run)
            self.assertTrue(deleted)


class RangeRequestTests(unittest.TestCase):
    """The _handle_*_range overrides are forked from Starlette; assert the bytes."""

    def test_single_range_returns_requested_bytes(self) -> None:
        with TempMediaFolder() as root:
            media = root / "clip.bin"
            payload = os.urandom(4096)
            media.write_bytes(payload)

            recorder = _serve(
                MediaFileResponse(media),
                _asgi_scope([(b"range", b"bytes=100-199")]),
            )

            self.assertEqual(recorder.status, 206)
            self.assertEqual(recorder.body, payload[100:200])
            self.assertEqual(recorder.headers["content-range"], f"bytes 100-199/{len(payload)}")
            self.assertEqual(recorder.headers["content-length"], "100")

    def test_open_ended_range_runs_to_end_of_file(self) -> None:
        with TempMediaFolder() as root:
            media = root / "clip.bin"
            payload = os.urandom(MediaFileResponse.chunk_size * 2 + 17)
            media.write_bytes(payload)

            recorder = _serve(
                MediaFileResponse(media),
                _asgi_scope([(b"range", b"bytes=1000-")]),
            )

            self.assertEqual(recorder.status, 206)
            self.assertEqual(recorder.body, payload[1000:])

    def test_multiple_ranges_return_multipart_body(self) -> None:
        with TempMediaFolder() as root:
            media = root / "clip.bin"
            payload = os.urandom(4096)
            media.write_bytes(payload)

            recorder = _serve(
                MediaFileResponse(media),
                _asgi_scope([(b"range", b"bytes=0-9,100-109")]),
            )

            self.assertEqual(recorder.status, 206)
            self.assertIn("multipart/byteranges", recorder.headers["content-range"])
            self.assertIn(payload[0:10], recorder.body)
            self.assertIn(payload[100:110], recorder.body)

    def test_unsatisfiable_range_answers_416(self) -> None:
        """Regression: cancelling before sending truncated this response."""
        with TempMediaFolder() as root:
            media = root / "clip.bin"
            media.write_bytes(os.urandom(512))

            recorder = _serve(
                MediaFileResponse(media),
                _asgi_scope([(b"range", b"bytes=9000-9100")]),
            )

            self.assertEqual(recorder.status, 416)
            self.assertEqual(recorder.headers["content-range"], "*/512")

    def test_malformed_range_answers_400(self) -> None:
        """Regression: cancelling before sending truncated this response."""
        with TempMediaFolder() as root:
            media = root / "clip.bin"
            media.write_bytes(os.urandom(512))

            recorder = _serve(
                MediaFileResponse(media),
                _asgi_scope([(b"range", b"widgets=0-9")]),
            )

            self.assertEqual(recorder.status, 400)
            self.assertTrue(recorder.body)


class StarletteApiGuardTests(unittest.TestCase):
    """starlette is pinned because these private FileResponse methods are overridden."""

    def test_overridden_methods_keep_their_signatures(self) -> None:
        expected = {
            "_handle_simple": ["self", "send", "send_header_only"],
            "_handle_single_range": [
                "self",
                "send",
                "start",
                "end",
                "file_size",
                "send_header_only",
            ],
            "_handle_multiple_ranges": [
                "self",
                "send",
                "ranges",
                "file_size",
                "send_header_only",
            ],
        }

        for name, parameters in expected.items():
            with self.subTest(method=name):
                base = getattr(FileResponse, name, None)
                self.assertIsNotNone(base, f"starlette FileResponse lost {name}")
                self.assertEqual(list(inspect.signature(base).parameters), parameters)
                # The override must still match what starlette calls it with.
                self.assertEqual(
                    list(inspect.signature(getattr(MediaFileResponse, name)).parameters),
                    parameters,
                )

    def test_generate_multipart_is_still_available(self) -> None:
        self.assertTrue(hasattr(FileResponse, "generate_multipart"))


if __name__ == "__main__":
    unittest.main()
