"""Typed JSON preferences backed by the SQLite ``preferences`` table."""

from __future__ import annotations

import json
from typing import Generic, TypeVar

from pydantic import BaseModel, TypeAdapter, ValidationError

from db import get_preference, set_preference

T = TypeVar("T", bound=BaseModel)


class JsonPreference(Generic[T]):
    """One preferences row holding a JSON-serialised Pydantic model.

    ``model`` must be constructible with no arguments: those defaults are what a
    missing, corrupt, or partially invalid row falls back to, field by field, so
    a bad stored value can never break the endpoint that reads it.
    """

    def __init__(self, key: str, model: type[T]) -> None:
        self.key = key
        self._model = model

    def get(self) -> T:
        raw = get_preference(self.key)
        if not raw:
            return self._model()

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return self._model()

        if not isinstance(data, dict):
            return self._model()

        try:
            return self._model.model_validate(data)
        except ValidationError:
            return self._salvage(data)

    def save(self, settings: T) -> T:
        set_preference(self.key, settings.model_dump_json())
        return settings

    def update(self, **changes: object) -> T:
        """Store the stored value with every non-``None`` change applied on top."""
        applied = {name: value for name, value in changes.items() if value is not None}
        return self.save(self.get().model_copy(update=applied))

    def _salvage(self, data: dict) -> T:
        """Keep each field that validates on its own, defaulting the rest."""
        salvaged: dict[str, object] = {}

        for name, field in self._model.model_fields.items():
            if name not in data:
                continue
            try:
                salvaged[name] = TypeAdapter(field.annotation).validate_python(data[name])
            except ValidationError:
                continue

        return self._model().model_copy(update=salvaged)
