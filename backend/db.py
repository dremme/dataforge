import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

_connections: list[sqlite3.Connection] = []


def get_db_path() -> Path:
    override = os.environ.get("DATAFORGE_DB_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "app.db"


def close_all_connections() -> None:
    while _connections:
        conn = _connections.pop()
        conn.close()


@contextmanager
def get_connection():
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    _connections.append(conn)
    try:
        yield conn
    finally:
        if conn in _connections:
            _connections.remove(conn)
        conn.close()


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS preferences (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.commit()

    from automation.jobs_store import init_jobs_table

    init_jobs_table()


def get_preference(key: str) -> str | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT value FROM preferences WHERE key = ?",
            (key,),
        ).fetchone()
    return row[0] if row else None


def set_preference(key: str, value: str) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO preferences (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        conn.commit()
