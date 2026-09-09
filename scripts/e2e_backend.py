"""Backend for the end-to-end auto-caption test: a throwaway workspace and a stand-in model.

Started by frontend/playwright.config.ts, never by hand. Reads DATAFORGE_E2E_WORKSPACE for
where to build the fixture folder and DATAFORGE_API_PORT for where to serve.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import uvicorn

# Before any backend import: older interpreters die on PEP 695 with a bare SyntaxError.
from py_version import require_python

require_python()

BACKEND = Path(__file__).resolve().parent.parent / "backend"

DEFAULT_API_PORT = 18090

#: Longer than DRAFT_CAPTION_THRESHOLD, or the runner scores it too_short and retries.
CAPTION = (
    "A red hatchback is parked on a gravel driveway beside a low stone wall, with a row of "
    "birch trees standing behind it and a wooden gate left open at the far end. Late "
    "afternoon light rakes across the gravel and throws long shadows toward the camera, and "
    "a bicycle leans against the wall on the left."
)

SYSPROMPT = "Describe the scene plainly, in one paragraph."

#: Short enough to stay under the threshold that skips a file as already written.
DRAFT = "A parked car."

REQUEST_LOG = "model-requests.json"


class ModelHandler(BaseHTTPRequestHandler):
    """The vision model's half of the round trip, recorded so the test can inspect the prompt."""

    workspace: Path

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's spelling
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        self._record(payload)

        body = json.dumps(
            {"choices": [{"message": {"content": CAPTION}, "finish_reason": "stop"}]}
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        return

    def _record(self, payload: dict[str, object]) -> None:
        log = self.workspace / REQUEST_LOG
        recorded = json.loads(log.read_text(encoding="utf-8")) if log.is_file() else []
        recorded.append(payload)
        log.write_text(json.dumps(recorded), encoding="utf-8")


def start_model_server(workspace: Path) -> int:
    handler = type("BoundModelHandler", (ModelHandler,), {"workspace": workspace})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_address[1]


def write_clip(path: Path, *, seconds: int = 2, fps: int = 10, size: int = 64) -> None:
    """Written with the library that reads it back, so a decodable clip needs no ffmpeg."""
    import cv2
    import numpy as np

    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (size, size))
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not open an mp4 writer, so the clip fixture is missing")

    try:
        for index in range(seconds * fps):
            frame = np.full((size, size, 3), index * 4 % 256, dtype=np.uint8)
            frame[:, : size // 2] = (index * 7) % 256
            writer.write(frame)
    finally:
        writer.release()

    capture = cv2.VideoCapture(str(path))
    try:
        readable, _frame = capture.read()
    finally:
        capture.release()

    if not readable:
        raise RuntimeError(f"{path.name} was written but cannot be decoded, so the test is moot")


def build_workspace(workspace: Path) -> None:
    from testing_fixtures import write_media, write_sysprompt, write_txt_caption

    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True)

    write_sysprompt(workspace, SYSPROMPT)
    write_txt_caption(write_media(workspace, "photo.png"), DRAFT)

    clip = workspace / "clip.mp4"
    write_clip(clip)
    write_txt_caption(clip, DRAFT)


def main() -> int:
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    # Before importing the app: it reads preferences, and a real .env would point at a real model.
    from testing_fixtures import isolate_test_database

    isolate_test_database()

    workspace = Path(os.environ["DATAFORGE_E2E_WORKSPACE"]).resolve()
    build_workspace(workspace)

    os.environ["OPENAI_API_BASE_URL"] = f"http://127.0.0.1:{start_model_server(workspace)}/v1"
    os.environ["OPENAI_MODEL"] = "e2e-stand-in"

    from main import app

    port = int(os.environ.get("DATAFORGE_API_PORT", DEFAULT_API_PORT))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
