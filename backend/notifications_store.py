"""SQLite persistence for the notification feed. Only the newest rows are kept."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from db import get_connection

#: The feed is a tail, not an archive: anything older is dropped on write.
MAX_NOTIFICATIONS = 50

# CREATE, SELECT and INSERT are all derived from this.
_NOTIFICATION_SCHEMA: tuple[tuple[str, str], ...] = (
    ("id", "TEXT PRIMARY KEY"),
    ("message", "TEXT NOT NULL"),
    ("variant", "TEXT NOT NULL DEFAULT 'success'"),
    ("source", "TEXT NOT NULL DEFAULT 'client'"),
    ("job_id", "TEXT"),
    ("count", "INTEGER NOT NULL DEFAULT 1"),
    ("created_at", "TEXT NOT NULL"),
    ("read_at", "TEXT"),
)

_COLUMN_NAMES = tuple(name for name, _ in _NOTIFICATION_SCHEMA)
_COLUMNS = ", ".join(_COLUMN_NAMES)
_PLACEHOLDERS = ", ".join("?" for _ in _COLUMN_NAMES)

#: ISO timestamps sort lexicographically; rowid breaks ties inside the same microsecond.
_NEWEST_FIRST = "ORDER BY created_at DESC, rowid DESC"


def init_notifications_table() -> None:
    columns = ", ".join(f"{name} {definition}" for name, definition in _NOTIFICATION_SCHEMA)
    with get_connection() as conn:
        conn.execute(f"CREATE TABLE IF NOT EXISTS notifications ({columns})")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)"
        )
        conn.commit()


def _row_to_dict(row: tuple[object, ...]) -> dict[str, object]:
    return dict(zip(_COLUMN_NAMES, row, strict=True))


def _collapses_into(row: tuple[object, ...], message: str, variant: str, source: str) -> bool:
    stored = _row_to_dict(row)
    return (
        stored["message"] == message and stored["variant"] == variant and stored["source"] == source
    )


def insert_notification(
    *,
    message: str,
    variant: str,
    source: str,
    job_id: str | None = None,
) -> dict[str, object]:
    """Record one notification, collapsing an immediate repeat, and trim to the newest 50."""
    now = datetime.now(tz=UTC).isoformat()

    with get_connection() as conn:
        newest = conn.execute(
            f"SELECT {_COLUMNS} FROM notifications {_NEWEST_FIRST} LIMIT 1"
        ).fetchone()

        if newest is not None and _collapses_into(newest, message, variant, source):
            row_id = str(newest[0])
            conn.execute(
                "UPDATE notifications SET count = count + 1, created_at = ?, read_at = NULL"
                " WHERE id = ?",
                (now, row_id),
            )
        else:
            row_id = uuid.uuid4().hex
            conn.execute(
                f"INSERT INTO notifications ({_COLUMNS}) VALUES ({_PLACEHOLDERS})",
                (row_id, message, variant, source, job_id, 1, now, None),
            )
            conn.execute(
                f"DELETE FROM notifications WHERE id NOT IN"
                f" (SELECT id FROM notifications {_NEWEST_FIRST} LIMIT ?)",
                (MAX_NOTIFICATIONS,),
            )

        row = conn.execute(
            f"SELECT {_COLUMNS} FROM notifications WHERE id = ?", (row_id,)
        ).fetchone()
        conn.commit()

    return _row_to_dict(row)


def list_notifications() -> list[dict[str, object]]:
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT {_COLUMNS} FROM notifications {_NEWEST_FIRST} LIMIT ?",
            (MAX_NOTIFICATIONS,),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def mark_all_read() -> None:
    now = datetime.now(tz=UTC).isoformat()
    with get_connection() as conn:
        conn.execute("UPDATE notifications SET read_at = ? WHERE read_at IS NULL", (now,))
        conn.commit()


def prune_notifications(days: int) -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM notifications WHERE julianday(created_at) < julianday('now', ?)",
            (f"-{days} days",),
        )
        conn.commit()
    return cursor.rowcount


def delete_all_notifications() -> int:
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM notifications")
        conn.commit()
    return cursor.rowcount


def clear_notifications_for_tests() -> None:
    delete_all_notifications()
