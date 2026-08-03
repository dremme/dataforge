from datetime import UTC, datetime
from pathlib import Path

from constants import SYSPROMPT_FILENAME


def sysprompt_path(folder: Path) -> Path:
    return folder / SYSPROMPT_FILENAME


def load_sysprompt(folder: Path) -> tuple[str | None, bool, str]:
    path = sysprompt_path(folder)

    if not path.is_file():
        return None, False, "none"

    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return None, True, "empty"

    stripped = text.strip()
    if stripped:
        return stripped, True, "text"
    return None, True, "empty"


def load_sysprompt_item(folder: Path) -> dict | None:
    path = sysprompt_path(folder)
    if not path.is_file():
        return None

    description, has_file, caption_status = load_sysprompt(folder)

    item_data = {
        "name": SYSPROMPT_FILENAME,
        "path": str(path),
        "description": description,
        "has_description": description is not None,
        "has_caption_file": has_file,
        "caption_status": caption_status,
        "caption_file_type": None,
        "media_type": "sysprompt",
    }

    if path.is_file():
        try:
            file_stat = path.stat()
            item_data["size"] = file_stat.st_size
            item_data["modified_at"] = datetime.fromtimestamp(
                file_stat.st_mtime,
                tz=UTC,
            ).isoformat()
        except OSError:
            pass

    return item_data


def save_sysprompt(folder: Path, text: str) -> dict:
    path = sysprompt_path(folder)
    normalized = text.strip()

    path.write_text(normalized + ("\n" if normalized else ""), encoding="utf-8")

    description, has_file, caption_status = load_sysprompt(folder)
    return {
        "description": description,
        "has_description": description is not None,
        "has_caption_file": has_file,
        "caption_status": caption_status,
        "path": str(path),
    }
