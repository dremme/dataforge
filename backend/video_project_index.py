"""Where the app has seen editor drafts, so the editor can list them across folders.

A draft is recorded when it is saved and whenever a folder listing finds it, so one copied in
from outside the app shows up once its folder is opened. Entries whose file is gone are dropped
by whoever reads the list; nothing else keeps the index in step with the disk.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path

from db import get_connection


def _key(path: Path) -> str:
    return os.path.normcase(str(path))


def init_video_project_index_table() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS video_project_drafts (
                key TEXT PRIMARY KEY,
                path TEXT NOT NULL
            )
            """
        )
        conn.commit()


def remember_drafts(paths: Iterable[Path]) -> None:
    rows = [(_key(path), str(path)) for path in paths]
    if not rows:
        return
    with get_connection() as conn:
        conn.executemany(
            "INSERT INTO video_project_drafts (key, path) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET path = excluded.path",
            rows,
        )
        conn.commit()


def forget_draft(path: Path) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM video_project_drafts WHERE key = ?", (_key(path),))
        conn.commit()


def known_draft_paths() -> list[Path]:
    with get_connection() as conn:
        rows = conn.execute("SELECT path FROM video_project_drafts").fetchall()
    return [Path(row[0]) for row in rows]
