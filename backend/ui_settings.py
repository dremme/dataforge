import json

from db import get_preference, set_preference

UI_SETTINGS_KEY = "ui_settings"
DEFAULT_SORT = "name-asc"
VALID_SORTS = frozenset(
    {
        "name-asc",
        "name-desc",
        "date-asc",
        "date-desc",
        "caption-asc",
        "caption-desc",
        "megapixels-asc",
        "megapixels-desc",
    }
)


def _default_settings() -> dict[str, str | bool]:
    return {"sort": DEFAULT_SORT, "show_automation_specs": False}


def _normalize_sort(value: object) -> str:
    if isinstance(value, str) and value in VALID_SORTS:
        return value
    return DEFAULT_SORT


def _normalize_show_automation_specs(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return False


def get_ui_settings() -> dict[str, str | bool]:
    raw = get_preference(UI_SETTINGS_KEY)
    if not raw:
        return _default_settings()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return _default_settings()

    if not isinstance(data, dict):
        return _default_settings()

    return {
        "sort": _normalize_sort(data.get("sort")),
        "show_automation_specs": _normalize_show_automation_specs(
            data.get("show_automation_specs")
        ),
    }


def update_ui_settings(
    *,
    sort: str | None = None,
    show_automation_specs: bool | None = None,
) -> dict[str, str | bool]:
    current = get_ui_settings()

    if sort is not None:
        current["sort"] = _normalize_sort(sort)

    if show_automation_specs is not None:
        current["show_automation_specs"] = show_automation_specs

    set_preference(UI_SETTINGS_KEY, json.dumps(current))
    return current
