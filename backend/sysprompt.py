from pathlib import Path

from constants import SYSPROMPT_FILENAME
from folder_instructions import find_instruction_file, read_instruction_file


def load_sysprompt(folder: Path) -> str | None:
    """The prompt from the nearest ``.sysprompt``, or ``None`` when that file is empty or unreadable."""
    path = find_instruction_file(folder, SYSPROMPT_FILENAME)
    if path is None:
        return None

    try:
        return read_instruction_file(path).strip() or None
    except OSError:
        return None
