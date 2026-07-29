import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

_connections: list[sqlite3.Connection] = []
_connections_lock = threading.Lock()


def get_db_path() -> Path:
    override = os.environ.get("DATAFORGE_DB_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "app.db"


def close_all_connections() -> None:
    with _connections_lock:
        open_connections = list(_connections)
        _connections.clear()

    for conn in open_connections:
        conn.close()


@contextmanager
def get_connection():
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    # Unlike journal_mode, synchronous is per-connection and not stored in the file.
    conn.execute("PRAGMA synchronous=NORMAL")
    with _connections_lock:
        _connections.append(conn)
    try:
        yield conn
    finally:
        with _connections_lock:
            if conn in _connections:
                _connections.remove(conn)
        conn.close()


def init_db() -> None:
    with get_connection() as conn:
        # WAL lets the UI keep reading while a running job writes progress. Journal
        # mode is stored in the database file, so setting it once here is enough.
        # Paired with synchronous=NORMAL it cannot corrupt the database; it only
        # risks losing the most recent commits on power loss, which for job progress
        # and UI preferences is a fine trade for much cheaper writes.
        conn.execute("PRAGMA journal_mode=WAL")
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
