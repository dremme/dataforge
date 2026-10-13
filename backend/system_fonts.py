"""The fonts installed on this machine, by family and style, for titles to choose from.

Pillow reads each face's own name table, so a family is listed under the name a font program
would show, whatever its file is called. A project names a family rather than a file, so it can
move between machines; a family that is not installed draws in the default font, in the preview
and the export alike, since both use the same title image.
"""

from __future__ import annotations

import os
import sys
import threading
from collections.abc import Iterable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from PIL import ImageFont

FONT_SUFFIXES = frozenset({".ttf", ".otf", ".ttc"})
#: A collection holds a handful of faces; the cap stops a malformed one from looping.
MAX_COLLECTION_FACES = 32
#: Listed first, in this order; any other style follows alphabetically.
STYLE_ORDER = ("Regular", "Italic", "Bold", "Bold Italic")
DEFAULT_STYLE = "Regular"


@dataclass(frozen=True, slots=True)
class FontFace:
    family: str
    style: str
    path: Path
    #: The face's position in a ``.ttc`` collection; 0 for a single-face file.
    index: int


def font_directories() -> list[Path]:
    home = Path.home()
    if sys.platform == "win32":
        windows = Path(os.environ.get("WINDIR", r"C:\Windows"))
        local = os.environ.get("LOCALAPPDATA")
        user = [Path(local) / "Microsoft" / "Windows" / "Fonts"] if local else []
        return [windows / "Fonts", *user]
    if sys.platform == "darwin":
        return [Path("/System/Library/Fonts"), Path("/Library/Fonts"), home / "Library" / "Fonts"]
    return [
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        home / ".local" / "share" / "fonts",
        home / ".fonts",
    ]


def read_faces(path: Path) -> list[tuple[str, str]]:
    """Family and style of each face in the file; empty when it is not a font Pillow reads."""
    faces: list[tuple[str, str]] = []
    count = MAX_COLLECTION_FACES if path.suffix.lower() == ".ttc" else 1
    for index in range(count):
        try:
            family, style = ImageFont.truetype(str(path), 12, index=index).getname()
        except (OSError, ValueError):
            break
        if family and style:
            faces.append((family, style))
    return faces


def _font_files(directories: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for directory in directories:
        with suppress(OSError):
            files.extend(
                path
                for path in directory.rglob("*")
                if path.suffix.lower() in FONT_SUFFIXES and path.is_file()
            )
    return sorted(files)


def _signature(directories: Iterable[Path]) -> tuple[tuple[str, int], ...]:
    """Installing or removing a font changes its directory's mtime, which rebuilds the index."""
    stamps: list[tuple[str, int]] = []
    for directory in directories:
        with suppress(OSError):
            stamps.append((str(directory), directory.stat().st_mtime_ns))
    return tuple(stamps)


class _FontIndex:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._signature: tuple[tuple[str, int], ...] | None = None
        self._faces: list[FontFace] = []

    def faces(self) -> list[FontFace]:
        directories = font_directories()
        signature = _signature(directories)
        with self._lock:
            if signature != self._signature:
                self._faces = _index(_font_files(directories))
                self._signature = signature
            return self._faces

    def clear(self) -> None:
        with self._lock:
            self._signature = None
            self._faces = []


def _index(files: Iterable[Path]) -> list[FontFace]:
    """One face per family and style: the first file found wins, as a font program would."""
    seen: set[tuple[str, str]] = set()
    faces: list[FontFace] = []
    for path in files:
        for index, (family, style) in enumerate(read_faces(path)):
            # A leading dot marks a macOS system face that apps are not meant to offer.
            key = (family.casefold(), style.casefold())
            if family.startswith(".") or key in seen:
                continue
            seen.add(key)
            faces.append(FontFace(family=family, style=style, path=path, index=index))
    return faces


_INDEX = _FontIndex()


def clear_font_index() -> None:
    _INDEX.clear()


def _style_key(style: str) -> tuple[int, str]:
    rank = STYLE_ORDER.index(style) if style in STYLE_ORDER else len(STYLE_ORDER)
    return rank, style.casefold()


def installed_families() -> list[tuple[str, list[str]]]:
    """Each family with its styles, families alphabetical and the four basic styles first."""
    # Keyed without case, so one family spelled two ways by two files is listed once.
    families: dict[str, tuple[str, list[str]]] = {}
    for face in _INDEX.faces():
        families.setdefault(face.family.casefold(), (face.family, []))[1].append(face.style)
    return [
        (family, sorted(styles, key=_style_key)) for _, (family, styles) in sorted(families.items())
    ]


def find_face(family: str, style: str) -> FontFace | None:
    """The face asked for; failing that its family's Regular, then the family's first style."""
    wanted = family.casefold()
    matches = [face for face in _INDEX.faces() if face.family.casefold() == wanted]
    if not matches:
        return None
    for candidate in (style, DEFAULT_STYLE):
        for face in matches:
            if face.style.casefold() == candidate.casefold():
                return face
    return min(matches, key=lambda face: _style_key(face.style))
