"""SQLite persistence for background job summaries and progress."""

from __future__ import annotations

import json
import sqlite3

from db import get_connection
from filesystem import normalize_user_path, path_leaf_name

# The single source of truth for the jobs table: the CREATE statements, the SELECT
# column list, the row mapping, the INSERT, and the add-missing-column migration are
# all derived from it. Adding a column means adding one line here.
_JOB_SCHEMA: tuple[tuple[str, str], ...] = (
    ("id", "TEXT PRIMARY KEY"),
    ("folder", "TEXT NOT NULL"),
    ("job_type", "TEXT NOT NULL DEFAULT 'auto_caption'"),
    ("status", "TEXT NOT NULL"),
    ("total", "INTEGER NOT NULL DEFAULT 0"),
    ("processed", "INTEGER NOT NULL DEFAULT 0"),
    ("current_file", "TEXT"),
    ("current_name", "TEXT"),
    ("stats_json", "TEXT NOT NULL DEFAULT '{}'"),
    ("results_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("error", "TEXT"),
    ("created_at", "TEXT NOT NULL"),
    ("started_at", "TEXT"),
    ("finished_at", "TEXT"),
    ("auto_caption_mode", "TEXT"),
    ("external_ref", "TEXT"),
)

_JOB_COLUMN_NAMES = tuple(name for name, _ in _JOB_SCHEMA)
_JOB_COLUMNS = ", ".join(_JOB_COLUMN_NAMES)

# ``results_json`` holds one entry per processed file, and an auto-caption entry carries
# the whole generated caption, so a finished run over a large folder is megabytes in a
# single cell. Queries that feed the job list read this narrower set and leave the blob
# on disk; ``get_job`` still reads it whole for ``/api/jobs/{id}/results``.
_JOB_SUMMARY_COLUMN_NAMES = tuple(name for name in _JOB_COLUMN_NAMES if name != "results_json")
_JOB_SUMMARY_COLUMNS = ", ".join(_JOB_SUMMARY_COLUMN_NAMES)

# Never overwritten by an update: the id identifies the row and the creation time is fixed.
_IMMUTABLE_JOB_COLUMNS = frozenset({"id", "created_at"})


def _create_jobs_table_sql(table: str, *, if_not_exists: bool = False) -> str:
    exists_clause = "IF NOT EXISTS " if if_not_exists else ""
    columns = ", ".join(f"{name} {definition}" for name, definition in _JOB_SCHEMA)
    return f"CREATE TABLE {exists_clause}{table} ({columns})"


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row[1] for row in rows}


def _migrate_legacy_auto_caption_jobs_table(conn: sqlite3.Connection) -> None:
    if not _table_exists(conn, "auto_caption_jobs"):
        return

    columns = _column_names(conn, "auto_caption_jobs")
    job_type_expr = "job_type" if "job_type" in columns else "'auto_caption'"

    conn.execute(
        f"""
        INSERT OR IGNORE INTO jobs (
            id, folder, job_type, status, total, processed, current_file, current_name,
            stats_json, results_json, error, created_at, started_at, finished_at
        )
        SELECT
            id, folder, {job_type_expr}, status, total, processed, current_file, current_name,
            stats_json, results_json, error, created_at, started_at, finished_at
        FROM auto_caption_jobs
        """
    )
    conn.execute("DROP TABLE auto_caption_jobs")
    conn.execute("DROP INDEX IF EXISTS idx_auto_caption_jobs_folder")
    conn.execute("DROP INDEX IF EXISTS idx_auto_caption_jobs_status")


def _migrate_add_missing_columns(conn: sqlite3.Connection) -> None:
    """Add any schema column the live table lacks, so the rebuild below can SELECT them all.

    SQLite only accepts an added column that is nullable or carries a default, which every
    column added since the original table has been. A new one that is neither fails loudly
    here at startup rather than corrupting anything.
    """
    existing = _column_names(conn, "jobs")
    for name, definition in _JOB_SCHEMA:
        if name not in existing:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {name} {definition}")


def _migrate_rebuild_jobs_table_if_needed(conn: sqlite3.Connection) -> None:
    """Drop columns the schema no longer declares. SQLite cannot ALTER them away."""
    if _column_names(conn, "jobs") == set(_JOB_COLUMN_NAMES):
        return

    conn.execute(_create_jobs_table_sql("jobs_new"))
    conn.execute(
        f"INSERT INTO jobs_new ({_JOB_COLUMNS}) SELECT {_JOB_COLUMNS} FROM jobs",
    )
    conn.execute("DROP TABLE jobs")
    conn.execute("ALTER TABLE jobs_new RENAME TO jobs")
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_jobs_folder
        ON jobs(folder, created_at DESC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_jobs_status
        ON jobs(status, created_at DESC)
        """
    )


def init_jobs_table() -> None:
    with get_connection() as conn:
        conn.execute(_create_jobs_table_sql("jobs", if_not_exists=True))
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_jobs_folder
            ON jobs(folder, created_at DESC)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_jobs_status
            ON jobs(status, created_at DESC)
            """
        )
        _migrate_legacy_auto_caption_jobs_table(conn)
        _migrate_add_missing_columns(conn)
        _migrate_rebuild_jobs_table_if_needed(conn)
        conn.commit()


def list_active_jobs() -> list[dict[str, object]]:
    """Jobs still marked queued or running. Read before recovery to find resumable work.

    Reads the full column set: a resumed job is put back under management and saved
    again, so it has to carry the results it already accumulated.
    """
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT {_JOB_COLUMNS} FROM jobs
            WHERE status IN ('queued', 'running')
            ORDER BY created_at DESC
            """
        ).fetchall()

    return [_row_to_dict(row) for row in rows]


def recover_stale_jobs() -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE jobs
            SET status = 'interrupted',
                error = COALESCE(error, 'Job interrupted when the server restarted.'),
                finished_at = COALESCE(finished_at, datetime('now'))
            WHERE status IN ('queued', 'running')
            """
        )
        conn.commit()
        return cursor.rowcount


def _normalize_folder(folder: str) -> str:
    return str(normalize_user_path(folder))


def _decode_json_object(raw: object) -> dict:
    try:
        decoded = json.loads(raw) if raw else {}  # type: ignore[arg-type]
    except (json.JSONDecodeError, TypeError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _decode_json_array(raw: object) -> list:
    try:
        decoded = json.loads(raw) if raw else []  # type: ignore[arg-type]
    except (json.JSONDecodeError, TypeError):
        return []
    return decoded if isinstance(decoded, list) else []


def _row_to_dict(row: tuple, columns: tuple[str, ...] = _JOB_COLUMN_NAMES) -> dict[str, object]:
    """Map one row to a job dict. ``results`` is absent when ``columns`` omits the blob.

    Absent rather than empty on purpose: an empty list would look like a job that
    produced no results, and re-saving such a job would erase what is on disk.
    """
    # Tolerate rows missing a newer column during a transition.
    padded = tuple(row) + (None,) * (len(columns) - len(row))
    values = dict(zip(columns, padded, strict=True))

    stats = _decode_json_object(values.pop("stats_json"))
    results = _decode_json_array(values.pop("results_json")) if "results_json" in values else None

    job: dict[str, object] = {
        **values,
        "folder_name": path_leaf_name(str(values["folder"] or "")),
        "job_type": str(values["job_type"] or "auto_caption"),
        "total": int(values["total"] or 0),
        "processed": int(values["processed"] or 0),
        "stats": {key: int(value) for key, value in stats.items()},
    }
    if results is not None:
        job["results"] = results
    return job


_SAVE_JOB_SQL = f"""
    INSERT INTO jobs ({_JOB_COLUMNS})
    VALUES ({", ".join("?" for _ in _JOB_COLUMN_NAMES)})
    ON CONFLICT(id) DO UPDATE SET {
    ", ".join(
        f"{name} = excluded.{name}"
        for name in _JOB_COLUMN_NAMES
        if name not in _IMMUTABLE_JOB_COLUMNS
    )
}
"""


def _job_column_value(job: dict[str, object], column: str) -> object:
    """The stored value for one column, applying the few per-column conversions."""
    if column == "folder":
        return _normalize_folder(str(job["folder"]))
    if column == "job_type":
        return job.get("job_type") or "auto_caption"
    if column in {"total", "processed"}:
        return int(job.get(column) or 0)
    if column == "stats_json":
        return json.dumps(job.get("stats") or {})
    if column == "results_json":
        return json.dumps(job.get("results") or [])
    return job.get(column)


def save_job(job: dict[str, object]) -> None:
    values = tuple(_job_column_value(job, column) for column in _JOB_COLUMN_NAMES)

    with get_connection() as conn:
        conn.execute(_SAVE_JOB_SQL, values)
        conn.commit()


def get_job(job_id: str) -> dict[str, object] | None:
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT {_JOB_COLUMNS} FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()

    return _row_to_dict(row) if row else None


def list_jobs(*, limit: int = 100) -> list[dict[str, object]]:
    """Job summaries, newest and most active first. Carries no per-file results."""
    safe_limit = max(1, min(limit, 100))

    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT {_JOB_SUMMARY_COLUMNS} FROM jobs
            ORDER BY
                CASE status
                    WHEN 'running' THEN 0
                    WHEN 'queued' THEN 1
                    ELSE 2
                END,
                created_at DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()

    return [_row_to_dict(row, _JOB_SUMMARY_COLUMN_NAMES) for row in rows]


def get_latest_job_for_folder(
    folder: str,
    *,
    job_type: str | None = None,
) -> dict[str, object] | None:
    normalized = _normalize_folder(folder)

    query = f"""
        SELECT {_JOB_SUMMARY_COLUMNS} FROM jobs
        WHERE folder = ?
    """
    params: list[object] = [normalized]
    if job_type:
        query += " AND job_type = ?"
        params.append(job_type)

    query += " ORDER BY created_at DESC LIMIT 1"

    with get_connection() as conn:
        row = conn.execute(query, params).fetchone()

    return _row_to_dict(row, _JOB_SUMMARY_COLUMN_NAMES) if row else None


def get_active_job_for_folder(
    folder: str,
    *,
    job_type: str | None = None,
) -> dict[str, object] | None:
    normalized = _normalize_folder(folder)

    query = f"""
        SELECT {_JOB_SUMMARY_COLUMNS} FROM jobs
        WHERE folder = ? AND status IN ('queued', 'running')
    """
    params: list[object] = [normalized]
    if job_type:
        query += " AND job_type = ?"
        params.append(job_type)

    query += " ORDER BY created_at DESC LIMIT 1"

    with get_connection() as conn:
        row = conn.execute(query, params).fetchone()

    return _row_to_dict(row, _JOB_SUMMARY_COLUMN_NAMES) if row else None


def delete_job(job_id: str) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM jobs WHERE id = ?",
            (job_id,),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_all_jobs() -> int:
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM jobs")
        conn.commit()
        return cursor.rowcount


def delete_jobs_for_folder(
    folder: str, *, job_type: str | None = None, keep_id: str | None = None
) -> int:
    """Delete job records for the given folder (and optionally job_type), except an optional keep_id.

    Used to enforce keeping only the latest job per folder per job type.
    Returns number of rows deleted.
    """
    normalized = _normalize_folder(folder)

    query = "DELETE FROM jobs WHERE folder = ?"
    params: list[object] = [normalized]
    if job_type:
        query += " AND job_type = ?"
        params.append(job_type)
    if keep_id:
        query += " AND id != ?"
        params.append(keep_id)

    with get_connection() as conn:
        cursor = conn.execute(query, params)
        conn.commit()
        return cursor.rowcount


def prune_duplicate_jobs() -> int:
    """Remove older job records so that only the most recent (by created_at) remains for each (folder, job_type).

    Returns the number of rows deleted. Safe to call on startup to clean legacy duplicate history.
    """
    with get_connection() as conn:
        cursor = conn.execute(
            """
            DELETE FROM jobs
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY folder, COALESCE(job_type, 'auto_caption')
                               ORDER BY created_at DESC, id
                           ) AS rn
                    FROM jobs
                ) sub
                WHERE rn = 1
            )
            """
        )
        conn.commit()
        return cursor.rowcount
