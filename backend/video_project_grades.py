"""Color grades saved by name, to apply the same look across generated shots and projects.

They live in the app database rather than in a project, so every project can use them.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from db import get_connection
from schemas import ColorAdjust, VideoProjectGrade


def init_video_project_grades_table() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS video_project_grades (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                adjust TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def _grade(row: tuple) -> VideoProjectGrade:
    grade_id, name, adjust, created_at = row
    return VideoProjectGrade(
        id=grade_id,
        name=name,
        adjust=ColorAdjust.model_validate_json(adjust),
        created_at=created_at,
    )


def list_grades() -> list[VideoProjectGrade]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, adjust, created_at FROM video_project_grades"
            " ORDER BY name COLLATE NOCASE"
        ).fetchall()
    return [_grade(row) for row in rows]


def save_grade(name: str, adjust: ColorAdjust) -> VideoProjectGrade:
    """A taken name, in any case, is replaced and keeps its id."""
    stamp = datetime.now(tz=UTC).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO video_project_grades (id, name, adjust, created_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(name) DO UPDATE SET name = excluded.name, adjust = excluded.adjust,"
            " created_at = excluded.created_at",
            (uuid.uuid4().hex, name, adjust.model_dump_json(), stamp),
        )
        row = conn.execute(
            "SELECT id, name, adjust, created_at FROM video_project_grades WHERE name = ?",
            (name,),
        ).fetchone()
        conn.commit()
    return _grade(row)


def delete_grade(grade_id: str) -> bool:
    with get_connection() as conn:
        deleted = conn.execute(
            "DELETE FROM video_project_grades WHERE id = ?", (grade_id,)
        ).rowcount
        conn.commit()
    return deleted > 0
