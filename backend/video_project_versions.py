"""Earlier states of a project, kept in the app database so a draft's folder stays uncluttered.

Versions are keyed by project id, which a draft keeps when its folder moves. Saves leave an
automatic checkpoint at most every ``VIDEO_PROJECT_CHECKPOINT_SECONDS``, and only the newest
``VIDEO_PROJECT_MAX_CHECKPOINTS`` of them; a named version stays until it is deleted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from constants import VIDEO_PROJECT_CHECKPOINT_SECONDS, VIDEO_PROJECT_MAX_CHECKPOINTS
from db import get_connection
from schemas import VideoProject, VideoProjectVersionSummary
from video_project import UNREADABLE_PROJECT_MESSAGE, project_duration, serialize_project

_SUMMARY_COLUMNS = "id, created_at, label, revision, name, duration, clip_count"
#: ISO timestamps sort lexicographically; rowid breaks ties inside the same microsecond.
_NEWEST_FIRST = "ORDER BY created_at DESC, rowid DESC"


def init_video_project_versions_table() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS video_project_versions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                label TEXT,
                revision INTEGER NOT NULL,
                name TEXT NOT NULL,
                duration REAL NOT NULL,
                clip_count INTEGER NOT NULL,
                project TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_video_project_versions_project"
            " ON video_project_versions(project_id, created_at DESC)"
        )
        conn.commit()


def _insert(conn, project: VideoProject, label: str | None, stamp: datetime) -> str:
    version_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO video_project_versions"
        f" ({_SUMMARY_COLUMNS}, project_id, project) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            version_id,
            stamp.isoformat(),
            label,
            project.revision,
            project.name,
            project_duration(project),
            len(project.clips),
            project.id,
            serialize_project(project),
        ),
    )
    return version_id


def record_checkpoint(project: VideoProject, *, now: datetime | None = None) -> bool:
    """Called with each saved revision; returns whether it was kept as a checkpoint."""
    stamp = now or datetime.now(tz=UTC)
    with get_connection() as conn:
        newest = conn.execute(
            "SELECT created_at FROM video_project_versions"
            f" WHERE project_id = ? AND label IS NULL {_NEWEST_FIRST} LIMIT 1",
            (project.id,),
        ).fetchone()
        due = newest is None or stamp - datetime.fromisoformat(newest[0]) >= timedelta(
            seconds=VIDEO_PROJECT_CHECKPOINT_SECONDS
        )
        if not due:
            return False
        _insert(conn, project, None, stamp)
        conn.execute(
            "DELETE FROM video_project_versions WHERE id IN ("
            " SELECT id FROM video_project_versions WHERE project_id = ? AND label IS NULL"
            f" {_NEWEST_FIRST} LIMIT -1 OFFSET ?)",
            (project.id, VIDEO_PROJECT_MAX_CHECKPOINTS),
        )
        conn.commit()
    return True


def save_named_version(project: VideoProject, label: str) -> VideoProjectVersionSummary:
    stamp = datetime.now(tz=UTC)
    with get_connection() as conn:
        version_id = _insert(conn, project, label, stamp)
        conn.commit()
    summary = read_summary(version_id)
    assert summary is not None
    return summary


def _summary(row: tuple) -> VideoProjectVersionSummary:
    version_id, created_at, label, revision, name, duration, clip_count = row
    return VideoProjectVersionSummary(
        id=version_id,
        created_at=created_at,
        label=label,
        revision=revision,
        name=name,
        duration=duration,
        clip_count=clip_count,
    )


def read_summary(version_id: str) -> VideoProjectVersionSummary | None:
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT {_SUMMARY_COLUMNS} FROM video_project_versions WHERE id = ?", (version_id,)
        ).fetchone()
    return _summary(row) if row else None


def list_versions(project_id: str) -> list[VideoProjectVersionSummary]:
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT {_SUMMARY_COLUMNS} FROM video_project_versions"
            f" WHERE project_id = ? {_NEWEST_FIRST}",
            (project_id,),
        ).fetchall()
    return [_summary(row) for row in rows]


def read_version(version_id: str) -> VideoProject | None:
    """Raises ``ValueError`` for a stored project that no longer validates."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT project FROM video_project_versions WHERE id = ?", (version_id,)
        ).fetchone()
    if row is None:
        return None
    try:
        return VideoProject.model_validate_json(row[0])
    except ValueError as exc:
        raise ValueError(UNREADABLE_PROJECT_MESSAGE) from exc


def delete_version(version_id: str) -> bool:
    with get_connection() as conn:
        deleted = conn.execute(
            "DELETE FROM video_project_versions WHERE id = ?", (version_id,)
        ).rowcount
        conn.commit()
    return deleted > 0


def delete_project_versions(project_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM video_project_versions WHERE project_id = ?", (project_id,))
        conn.commit()
