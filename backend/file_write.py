from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def _temporary_file(destination: Path) -> Iterator[Path]:
    descriptor, name = tempfile.mkstemp(prefix=".write-", suffix=".tmp", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        yield temporary
    finally:
        temporary.unlink(missing_ok=True)


def write_text_atomic(destination: Path, text: str) -> None:
    with _temporary_file(destination) as temporary:
        temporary.write_text(text, encoding="utf-8")
        os.replace(temporary, destination)


def copy_file_atomic(source: Path, destination: Path, *, overwrite: bool = True) -> bool:
    if not overwrite and destination.exists():
        return False
    with _temporary_file(destination) as temporary:
        shutil.copy2(source, temporary)
        if overwrite:
            os.replace(temporary, destination)
        else:
            try:
                if os.name == "nt":
                    os.rename(temporary, destination)
                else:
                    os.link(temporary, destination)
            except FileExistsError:
                return False
    return True
