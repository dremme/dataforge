"""SQLite persistence for background job summaries and progress."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from db import get_connection

_JOB_COLUMNS = """
    id, folder, job_type, status, total, processed, current_file, current_name,
    stats_json, results_json, error, created_at, started_at, finished_at,
    auto_caption_mode
"""

_CREATE_JOBS_TABLE = """
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        folder TEXT NOT NULL,
        job_type TEXT NOT NULL DEFAULT 'auto_caption',
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        current_file TEXT,
        current_name TEXT,
        stats_json TEXT NOT NULL DEFAULT '{}',
        results_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        auto_caption_mode TEXT
    )
"""


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


def _migrate_add_auto_caption_mode_column(conn: sqlite3.Connection) -> None:
    columns = _column_names(conn, "jobs")
    if "auto_caption_mode" not in columns:
        conn.execute("ALTER TABLE jobs ADD COLUMN auto_caption_mode TEXT")


def _migrate_rebuild_jobs_table_if_needed(conn: sqlite3.Connection) -> None:
    columns = _column_names(conn, "jobs")
    if len(columns) == 15 and "auto_caption_mode" in columns:
        return

    conn.execute(
        """
        CREATE TABLE jobs_new (
            id TEXT PRIMARY KEY,
            folder TEXT NOT NULL,
            job_type TEXT NOT NULL DEFAULT 'auto_caption',
            status TEXT NOT NULL,
            total INTEGER NOT NULL DEFAULT 0,
            processed INTEGER NOT NULL DEFAULT 0,
            current_file TEXT,
            current_name TEXT,
            stats_json TEXT NOT NULL DEFAULT '{}',
            results_json TEXT NOT NULL DEFAULT '[]',
            error TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            auto_caption_mode TEXT
        )
        """
    )
    conn.execute(
        """
        INSERT INTO jobs_new (
            id, folder, job_type, status, total, processed, current_file, current_name,
            stats_json, results_json, error, created_at, started_at, finished_at,
            auto_caption_mode
        )
        SELECT
            id, folder, job_type, status, total, processed, current_file, current_name,
            stats_json, results_json, error, created_at, started_at, finished_at,
            auto_caption_mode
        FROM jobs
        """
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
        conn.execute(_CREATE_JOBS_TABLE)
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
        _migrate_add_auto_caption_mode_column(conn)
        _migrate_rebuild_jobs_table_if_needed(conn)
        conn.commit()


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
    return str(Path(folder).expanduser().resolve())


def _row_to_dict(row: tuple) -> dict[str, object]:
    (
        job_id,
        folder,
        job_type,
        status,
        total,
        processed,
        current_file,
        current_name,
        stats_json,
        results_json,
        error,
        created_at,
        started_at,
        finished_at,
        auto_caption_mode,
    ) = row + (None,) * (15 - len(row))  # tolerate old rows missing column during transition

    try:
        stats = json.loads(stats_json) if stats_json else {}
    except json.JSONDecodeError:
        stats = {}

    try:
        results = json.loads(results_json) if results_json else []
    except json.JSONDecodeError:
        results = []

    if not isinstance(stats, dict):
        stats = {}
    if not isinstance(results, list):
        results = []

    folder_path = Path(folder)

    return {
        "id": job_id,
        "folder": folder,
        "folder_name": folder_path.name or str(folder_path),
        "job_type": str(job_type or "auto_caption"),
        "status": status,
        "total": int(total or 0),
        "processed": int(processed or 0),
        "current_file": current_file,
        "current_name": current_name,
        "stats": {key: int(value) for key, value in stats.items()},
        "results": results,
        "error": error,
        "created_at": created_at,
        "started_at": started_at,
        "finished_at": finished_at,
        "auto_caption_mode": auto_caption_mode,
    }


def save_job(job: dict[str, object]) -> None:
    folder = _normalize_folder(str(job["folder"]))

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                id, folder, job_type, status, total, processed, current_file, current_name,
                stats_json, results_json, error, created_at, started_at, finished_at,
                auto_caption_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                folder = excluded.folder,
                job_type = excluded.job_type,
                status = excluded.status,
                total = excluded.total,
                processed = excluded.processed,
                current_file = excluded.current_file,
                current_name = excluded.current_name,
                stats_json = excluded.stats_json,
                results_json = excluded.results_json,
                error = excluded.error,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                auto_caption_mode = excluded.auto_caption_mode
            """,
            (
                job["id"],
                folder,
                job.get("job_type") or "auto_caption",
                job["status"],
                int(job.get("total") or 0),
                int(job.get("processed") or 0),
                job.get("current_file"),
                job.get("current_name"),
                json.dumps(job.get("stats") or {}),
                json.dumps(job.get("results") or []),
                job.get("error"),
                job["created_at"],
                job.get("started_at"),
                job.get("finished_at"),
                job.get("auto_caption_mode"),
            ),
        )
        conn.commit()


def get_job(job_id: str) -> dict[str, object] | None:
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT {_JOB_COLUMNS} FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()

    return _row_to_dict(row) if row else None


def list_jobs(*, limit: int = 100) -> list[dict[str, object]]:
    safe_limit = max(1, min(limit, 100))

    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT {_JOB_COLUMNS} FROM jobs
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

    return [_row_to_dict(row) for row in rows]


def get_latest_job_for_folder(
    folder: str,
    *,
    job_type: str | None = None,
) -> dict[str, object] | None:
    normalized = _normalize_folder(folder)

    query = f"""
        SELECT {_JOB_COLUMNS} FROM jobs
        WHERE folder = ?
    """
    params: list[object] = [normalized]
    if job_type:
        query += " AND job_type = ?"
        params.append(job_type)

    query += " ORDER BY created_at DESC LIMIT 1"

    with get_connection() as conn:
        row = conn.execute(query, params).fetchone()

    return _row_to_dict(row) if row else None


def get_active_job_for_folder(
    folder: str,
    *,
    job_type: str | None = None,
) -> dict[str, object] | None:
    normalized = _normalize_folder(folder)

    query = f"""
        SELECT {_JOB_COLUMNS} FROM jobs
        WHERE folder = ? AND status IN ('queued', 'running')
    """
    params: list[object] = [normalized]
    if job_type:
        query += " AND job_type = ?"
        params.append(job_type)

    query += " ORDER BY created_at DESC LIMIT 1"

    with get_connection() as conn:
        row = conn.execute(query, params).fetchone()

    return _row_to_dict(row) if row else None


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
