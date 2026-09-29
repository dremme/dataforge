"""Whether a service answers at an address, before the user saves it."""

from __future__ import annotations

import httpx

from app_settings import effective_settings, validate_url
from schemas import ServiceProbeRequest, ServiceProbeResponse

PROBE_TIMEOUT_SECONDS = 5.0

_HEALTH_PATHS = {"comfy": "/system_stats", "ai_toolkit": "/api/gpu"}


def _unreachable(detail: str) -> ServiceProbeResponse:
    return ServiceProbeResponse(reachable=False, detail=detail)


def _model_ids(response: httpx.Response) -> list[str]:
    try:
        entries = response.json().get("data", [])
    except (ValueError, AttributeError):
        return []
    ids = {entry.get("id") for entry in entries if isinstance(entry, dict)}
    return sorted(model for model in ids if isinstance(model, str) and model)


def probe_service(request: ServiceProbeRequest) -> ServiceProbeResponse:
    """Raises ``ValueError`` for an unusable URL. Details never repeat the key."""
    base_url = validate_url(request.base_url)
    headers: dict[str, str] = {}
    if request.service == "vision":
        key = (request.api_key or "").strip() or effective_settings().vision_api_key
        headers["Authorization"] = f"Bearer {key}"
        path = "/models"
    else:
        path = _HEALTH_PATHS[request.service]

    try:
        with httpx.Client(
            base_url=base_url, headers=headers, timeout=PROBE_TIMEOUT_SECONDS
        ) as client:
            response = client.get(path)
    except httpx.TimeoutException:
        return _unreachable(f"No answer within {PROBE_TIMEOUT_SECONDS:g} seconds")
    except httpx.ConnectError:
        return _unreachable("Connection refused")
    except httpx.HTTPError:
        return _unreachable("Could not connect")

    if response.status_code in {401, 403}:
        return _unreachable(f"HTTP {response.status_code}: check the API key")
    if not response.is_success:
        return _unreachable(f"HTTP {response.status_code}")

    models = _model_ids(response) if request.service == "vision" else []
    return ServiceProbeResponse(reachable=True, models=models)
