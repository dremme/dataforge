"""Typed JSON preferences backed by the SQLite ``preferences`` table."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from db import get_preference, set_preference


def validate_or_salvage[T: BaseModel](model: type[T], data: dict) -> T:
    """Build ``model`` from ``data``, keeping each field that validates on its own.

    ``model`` must be constructible with no arguments: those defaults are what an
    invalid field falls back to, so a bad stored value can never break the
    endpoint that reads it.
    """
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
    """The row's JSON object, or ``None`` when it is missing or unusable."""
    raw = get_preference(key)
    if not raw:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None

    return data if isinstance(data, dict) else None


class JsonPreference[T: BaseModel]:
    """One preferences row holding a JSON-serialised Pydantic model.

    ``model`` must be constructible with no arguments: those defaults are what a
    missing, corrupt, or partially invalid row falls back to, field by field, so
    a bad stored value can never break the endpoint that reads it.
    """

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
        """Store the stored value with every non-``None`` change applied on top."""
        applied = {name: value for name, value in changes.items() if value is not None}
        return self.save(self.get().model_copy(update=applied))


class FolderScopedEnvelope(BaseModel):
    """The last save, plus a save per folder key.

    Payloads stay untyped on purpose. Were this ``dict[str, T]``, one corrupt
    folder entry would fail validation of the whole envelope and take every
    other folder down with it; as plain mappings the envelope always validates
    and each payload is salvaged on read, so a bad entry costs one folder.
    """

    latest: dict[str, object] | None = None
    by_folder: dict[str, dict[str, object]] = Field(default_factory=dict)


class FolderScopedPreference[T: BaseModel]:
    """Settings remembered per folder, falling back to the most recent save.

    A folder nobody has saved for reads ``latest`` — the settings last used
    anywhere — rather than the model defaults, so a new folder starts from
    whatever the user is actually working with. ``folder_key`` must already be
    canonical: callers apply :func:`filesystem.preference_folder_key`, which
    this module deliberately does not import (it would pull the whole media
    scanning stack into a module that only needs ``db``).
    """

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
        """The settings last saved for any folder."""
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
