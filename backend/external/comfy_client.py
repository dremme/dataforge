"""Drive a running ComfyUI over its HTTP API.

The contract is four calls per image: upload the source, submit a patched prompt graph,
poll history until the prompt leaves the queue, then fetch the bytes the output node
wrote. Free functions taking an ``httpx.Client``, like ``external.ostris_jobs`` - the
caller owns the client so one job can hold one connection pool for its whole run.

Polling rather than the websocket: the job's unit of progress is a file, and the socket
only carries sub-image sampler steps, which ``JobResponse`` has nowhere to put. History
stays the authority on whether a prompt finished either way, so adding the socket later
would not change anything here.
"""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Any

import httpx

from comfy_settings import get_comfy_base_url

# Queue, history and status probes are all small JSON over loopback.
COMFY_REQUEST_TIMEOUT_SECONDS = 10.0
# A 4K PNG going out, and a possibly larger one coming back.
COMFY_TRANSFER_TIMEOUT_SECONDS = 120.0
COMFY_POLL_INTERVAL_SECONDS = 1.0

# Uploads land under one subfolder of ComfyUI's input directory rather than loose among
# the user's own files. ComfyUI has no delete-input endpoint, so this is what makes the
# debris identifiable and removable by hand.
COMFY_INPUT_SUBFOLDER = "dataforge"

_TERMINAL_STATUS_STRINGS = frozenset({"success", "error"})


class ComfyError(Exception):
    """Any failure talking to ComfyUI."""


class ComfyUnavailableError(ComfyError):
    """ComfyUI did not answer at all."""


class ComfyPromptError(ComfyError):
    """ComfyUI rejected the graph, or failed while executing it."""


def comfy_url(path: str) -> str:
    return f"{get_comfy_base_url()}/{path.lstrip('/')}"


def _image_media_type(source: Path) -> str:
    guessed, _ = mimetypes.guess_type(source.name)
    return guessed or "application/octet-stream"


def _node_error_text(payload: dict[str, Any]) -> str:
    """The most specific message ComfyUI offers about a rejected graph."""
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        details = error.get("details")
        if isinstance(message, str) and message:
            return f"{message}: {details}" if isinstance(details, str) and details else message
    if isinstance(error, str) and error:
        return error

    node_errors = payload.get("node_errors")
    if isinstance(node_errors, dict):
        for node_id, entry in node_errors.items():
            errors = entry.get("errors") if isinstance(entry, dict) else None
            first = errors[0] if isinstance(errors, list) and errors else None
            message = first.get("message") if isinstance(first, dict) else None
            if isinstance(message, str) and message:
                return f"node {node_id}: {message}"
        return "; ".join(str(node_id) for node_id in node_errors)

    return "ComfyUI rejected the workflow"


def upload_image(
    client: httpx.Client,
    source: Path,
    *,
    name: str,
    subfolder: str = COMFY_INPUT_SUBFOLDER,
) -> str:
    """Put ``source`` in ComfyUI's input folder, returning the LoadImage widget value.

    Uploaded rather than written straight into ComfyUI's ``input`` directory: an upload
    is the only path that still works when ComfyUI is a container or another machine,
    and it needs no write access to someone else's install.

    ``name`` must be unique per image. Reusing one filename would keep the input folder
    tidy and is safe with the stock ``LoadImage`` - it hashes file content in
    ``IS_CHANGED`` - but a custom loader without ``IS_CHANGED`` would serve the previous
    image's cached result, and the failure looks like a model that ignored its input.
    """
    files = {"image": (name, source.read_bytes(), _image_media_type(source))}
    data = {"type": "input", "subfolder": subfolder, "overwrite": "true"}

    try:
        response = client.post(
            comfy_url("/upload/image"),
            files=files,
            data=data,
            timeout=COMFY_TRANSFER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as error:
        raise ComfyUnavailableError(str(error)) from error
    except json.JSONDecodeError as error:
        raise ComfyError("ComfyUI returned an unreadable upload response") from error

    stored = payload.get("name") if isinstance(payload, dict) else None
    if not isinstance(stored, str) or not stored:
        raise ComfyError("ComfyUI accepted the upload without naming the file")

    folder = payload.get("subfolder") if isinstance(payload, dict) else ""
    return f"{folder}/{stored}" if isinstance(folder, str) and folder else stored


def submit_prompt(client: httpx.Client, prompt: dict[str, Any], *, client_id: str) -> str:
    """Queue a patched graph, returning its prompt id.

    A rejected graph is reported two different ways depending on the build - a 400 with
    an ``error`` body, or a 200 carrying ``node_errors`` - so both are checked. Trusting
    the status code alone would have the job wait out its timeout on a prompt that was
    never queued.
    """
    try:
        response = client.post(
            comfy_url("/prompt"),
            json={"prompt": prompt, "client_id": client_id},
            timeout=COMFY_REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as error:
        raise ComfyUnavailableError(str(error)) from error

    try:
        payload = response.json()
    except json.JSONDecodeError:
        payload = {}

    if response.status_code >= 400:
        raise ComfyPromptError(_node_error_text(payload if isinstance(payload, dict) else {}))

    if not isinstance(payload, dict):
        raise ComfyError("ComfyUI returned an unreadable prompt response")

    if payload.get("node_errors"):
        raise ComfyPromptError(_node_error_text(payload))

    prompt_id = payload.get("prompt_id")
    if not isinstance(prompt_id, str) or not prompt_id:
        raise ComfyError("ComfyUI queued the workflow without returning a prompt id")

    return prompt_id


def fetch_history(client: httpx.Client, prompt_id: str) -> dict[str, Any] | None:
    """The finished run's entry, or None while it is still queued or executing."""
    try:
        response = client.get(
            comfy_url(f"/history/{prompt_id}"),
            timeout=COMFY_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as error:
        raise ComfyUnavailableError(str(error)) from error
    except json.JSONDecodeError as error:
        raise ComfyError("ComfyUI returned an unreadable history response") from error

    if not isinstance(payload, dict):
        return None

    entry = payload.get(prompt_id)
    return entry if isinstance(entry, dict) else None


def history_is_finished(entry: dict[str, Any]) -> bool:
    status = entry.get("status")
    if not isinstance(status, dict):
        # Older builds report no status block at all; an entry with outputs is done.
        return bool(entry.get("outputs"))

    if status.get("completed") is True:
        return True
    return str(status.get("status_str", "")).lower() in _TERMINAL_STATUS_STRINGS


def history_error_text(entry: dict[str, Any]) -> str | None:
    """The reason a finished run failed, or None if it succeeded."""
    status = entry.get("status")
    if not isinstance(status, dict):
        return None
    if str(status.get("status_str", "")).lower() != "error":
        return None

    messages = status.get("messages")
    if isinstance(messages, list):
        for message in reversed(messages):
            if not isinstance(message, list) or len(message) < 2:
                continue
            kind, data = message[0], message[1]
            if kind != "execution_error" or not isinstance(data, dict):
                continue
            text = data.get("exception_message")
            node = data.get("node_type")
            if isinstance(text, str) and text:
                return f"{node}: {text}" if isinstance(node, str) and node else text

    return "ComfyUI reported an execution error"


def history_outputs(entry: dict[str, Any]) -> list[dict[str, str]]:
    """Every image the run wrote, as ``{filename, subfolder, type}`` refs.

    Only the ``images`` key is read. Video nodes report under ``gifs``/``videos``, which
    is a separate contract - a still workflow is what this job runs, and reporting "no
    output" for a video graph is the honest answer rather than a partial guess.
    """
    outputs = entry.get("outputs")
    if not isinstance(outputs, dict):
        return []

    refs: list[dict[str, str]] = []
    for node_output in outputs.values():
        images = node_output.get("images") if isinstance(node_output, dict) else None
        if not isinstance(images, list):
            continue
        for image in images:
            if not isinstance(image, dict):
                continue
            filename = image.get("filename")
            if not isinstance(filename, str) or not filename:
                continue
            refs.append(
                {
                    "filename": filename,
                    "subfolder": str(image.get("subfolder") or ""),
                    "type": str(image.get("type") or "output"),
                }
            )
    return refs


def download_view(client: httpx.Client, ref: dict[str, str]) -> bytes:
    """The bytes behind one output ref.

    The three fields are passed straight through from history, which is what lets a
    preset author choose SaveImage or PreviewImage with no branching here: a preview
    lands as ``type=temp`` and ComfyUI cleans it up itself.
    """
    try:
        response = client.get(
            comfy_url("/view"),
            params=ref,
            timeout=COMFY_TRANSFER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise ComfyUnavailableError(str(error)) from error

    return response.content


def fetch_queue(client: httpx.Client) -> tuple[list[str], list[str]]:
    """Prompt ids ComfyUI is running now, and those still pending."""
    try:
        response = client.get(comfy_url("/queue"), timeout=COMFY_REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as error:
        raise ComfyUnavailableError(str(error)) from error
    except json.JSONDecodeError as error:
        raise ComfyError("ComfyUI returned an unreadable queue response") from error

    if not isinstance(payload, dict):
        return ([], [])

    def _ids(key: str) -> list[str]:
        entries = payload.get(key)
        if not isinstance(entries, list):
            return []
        # Each entry is a tuple-ish list whose second element is the prompt id.
        return [
            entry[1]
            for entry in entries
            if isinstance(entry, list) and len(entry) > 1 and isinstance(entry[1], str)
        ]

    return (_ids("queue_running"), _ids("queue_pending"))


def interrupt(client: httpx.Client) -> None:
    """Stop whatever ComfyUI is executing right now.

    Deliberately blunt: ComfyUI has no per-prompt interrupt, so this kills the running
    prompt whoever queued it. Callers must confirm the running prompt is theirs - see
    ``automation.comfy_process._request_stop`` - or they will cancel the user's own work
    in the ComfyUI tab.
    """
    try:
        response = client.post(comfy_url("/interrupt"), timeout=COMFY_REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise ComfyUnavailableError(str(error)) from error


def delete_queued(client: httpx.Client, prompt_id: str) -> None:
    """Drop a still-pending prompt from the queue."""
    try:
        response = client.post(
            comfy_url("/queue"),
            json={"delete": [prompt_id]},
            timeout=COMFY_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise ComfyUnavailableError(str(error)) from error


def probe_available() -> bool:
    """Whether ComfyUI answers, for the dialog to say so before a job is queued."""
    try:
        with httpx.Client(timeout=COMFY_REQUEST_TIMEOUT_SECONDS) as client:
            response = client.get(comfy_url("/system_stats"))
            response.raise_for_status()
    except httpx.HTTPError:
        return False
    return True
