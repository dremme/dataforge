from __future__ import annotations

import json

from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from db import get_preference, set_preference


def validate_or_salvage[T: BaseModel](model: type[T], data: dict) -> T:
    """Keep each field that validates on its own. ``model`` must be constructible with no arguments."""
    try:
        return model.model_validate(data)
    except ValidationError:
        pass

    salvaged: dict[str, object] = {}

    for name, field in model.model_fields.items():
        if name not in data:
            continue
        try:
            salvaged[name] = TypeAdapter(field.annotation).validate_python(data[name])
        except ValidationError:
            continue

    return model().model_copy(update=salvaged)


def _stored_mapping(key: str) -> dict | None:
    raw = get_preference(key)
    if not raw:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None

    return data if isinstance(data, dict) else None


class JsonPreference[T: BaseModel]:
    """``model`` must be constructible with no arguments so a bad stored value cannot break the reader."""

    def __init__(self, key: str, model: type[T]) -> None:
        self.key = key
        self._model = model

    def get(self) -> T:
        data = _stored_mapping(self.key)
        return self._model() if data is None else validate_or_salvage(self._model, data)

    def save(self, settings: T) -> T:
        set_preference(self.key, settings.model_dump_json())
        return settings

    def update(self, **changes: object) -> T:
        applied = {name: value for name, value in changes.items() if value is not None}
        return self.save(self.get().model_copy(update=applied))


class FolderScopedEnvelope(BaseModel):
    """Payloads stay untyped: a typed ``dict[str, T]`` would fail the whole envelope on one corrupt folder."""

    latest: dict[str, object] | None = None
    by_folder: dict[str, dict[str, object]] = Field(default_factory=dict)


class FolderScopedPreference[T: BaseModel]:
    """Falls back to the most recent save. ``folder_key`` must already be canonical; this module does not import filesystem."""

    def __init__(self, key: str, model: type[T]) -> None:
        self.key = key
        self._model = model
        self._envelope: JsonPreference[FolderScopedEnvelope] = JsonPreference(
            key, FolderScopedEnvelope
        )

    def get(self, folder_key: str) -> T:
        envelope = self._envelope.get()
        payload = envelope.by_folder.get(folder_key)
        if payload is None:
            payload = envelope.latest
        return self._model() if payload is None else validate_or_salvage(self._model, payload)

    def latest(self) -> T:
        payload = self._envelope.get().latest
        return self._model() if payload is None else validate_or_salvage(self._model, payload)

    def save(self, folder_key: str, settings: T) -> T:
        payload = settings.model_dump(mode="json")
        envelope = self._envelope.get()
        self._envelope.save(
            envelope.model_copy(
                update={
                    "latest": payload,
                    "by_folder": {**envelope.by_folder, folder_key: payload},
                }
            )
        )
        return settings
