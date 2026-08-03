"""SQLite storage layer.

All SQL lives here so the UI never builds a query. The connection is opened
once and shared; every write commits immediately because the app is
single-user and interactive, so throughput is irrelevant next to durability.
"""

from __future__ import annotations

import shutil
import sqlite3
from datetime import date as _date
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from . import paths

SCHEMA_VERSION = 1

STATUS_PRESENT = "Present"
STATUS_ABSENT = "Absent"
STATUS_LATE = "Late"
STATUSES = (STATUS_PRESENT, STATUS_ABSENT, STATUS_LATE)

#: Statuses for which a reason is meaningful.
REASON_STATUSES = (STATUS_ABSENT, STATUS_LATE)

KIND_ROSTER = "roster"
KIND_WALKIN = "walkin"

BACKUPS_TO_KEEP = 14

#: Employees a brand-new database starts with, so a fresh install is ready to
#: use immediately. Names are stored exactly as written — capitalisation of a
#: person's own name is not ours to correct.
DEFAULT_EMPLOYEES = (
    "Kareem",
    "Hana",
    "Marwa",
    "Sara ahmed al balushi",
    "Sara al balushi",
    "Ibad",
    "Khuloud",
    "Laila",
    "Ruqiaya",
    "Jihad",
    "Hamood",
    "Mohammad",
    "Fatma",
)

_conn: Optional[sqlite3.Connection] = None


# --------------------------------------------------------------------------
# connection / schema
# --------------------------------------------------------------------------

def connect(db_file: Optional[Path] = None) -> sqlite3.Connection:
    """Open (once) and return the shared connection, creating the schema."""
    global _conn
    if _conn is not None:
        return _conn

    paths.ensure_dirs()
    target = db_file or paths.db_path()
    conn = sqlite3.connect(str(target), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    _migrate(conn)
    _conn = conn
    return conn


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def _migrate(conn: sqlite3.Connection) -> None:
    """Create or upgrade the schema based on ``PRAGMA user_version``.

    Guards against an updated build meeting an older database.
    """
    current = conn.execute("PRAGMA user_version").fetchone()[0]

    if current < 1:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS people (
                id         INTEGER PRIMARY KEY,
                name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
                kind       TEXT NOT NULL DEFAULT 'roster',
                active     INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attendance (
                id          INTEGER PRIMARY KEY,
                person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
                date        TEXT NOT NULL,
                status      TEXT NOT NULL,
                reason      TEXT NOT NULL DEFAULT '',
                recorded_at TEXT NOT NULL,
                UNIQUE(person_id, date)
            );

            CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
            CREATE INDEX IF NOT EXISTS idx_attendance_person ON attendance(person_id);
            """
        )
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def today_str() -> str:
    return _date.today().isoformat()


# --------------------------------------------------------------------------
# people
# --------------------------------------------------------------------------

def add_person(name: str, kind: str = KIND_ROSTER) -> int:
    """Add a person and return their id.

    If the name already exists the existing row is reused and reactivated,
    which is what a user means when they re-add someone they removed.
    """
    name = name.strip()
    if not name:
        raise ValueError("Name cannot be empty.")

    conn = connect()
    existing = conn.execute(
        "SELECT id, active FROM people WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if existing:
        if not existing["active"]:
            conn.execute("UPDATE people SET active = 1 WHERE id = ?", (existing["id"],))
            conn.commit()
        return int(existing["id"])

    cur = conn.execute(
        "INSERT INTO people (name, kind, active, created_at) VALUES (?, ?, 1, ?)",
        (name, kind, _now()),
    )
    conn.commit()
    return int(cur.lastrowid)


def rename_person(person_id: int, new_name: str) -> None:
    new_name = new_name.strip()
    if not new_name:
        raise ValueError("Name cannot be empty.")
    conn = connect()
    clash = conn.execute(
        "SELECT id FROM people WHERE name = ? COLLATE NOCASE AND id != ?",
        (new_name, person_id),
    ).fetchone()
    if clash:
        raise ValueError(f"Another person is already named '{new_name}'.")
    conn.execute("UPDATE people SET name = ? WHERE id = ?", (new_name, person_id))
    conn.commit()


def set_person_active(person_id: int, active: bool) -> None:
    """Soft delete / restore. History is always preserved."""
    conn = connect()
    conn.execute("UPDATE people SET active = ? WHERE id = ?", (1 if active else 0, person_id))
    conn.commit()


def promote_to_roster(person_id: int) -> None:
    """Turn a walk-in into a permanent roster member."""
    conn = connect()
    conn.execute("UPDATE people SET kind = ? WHERE id = ?", (KIND_ROSTER, person_id))
    conn.commit()


def delete_person(person_id: int) -> None:
    """Permanently remove a person **and** their attendance records."""
    conn = connect()
    conn.execute("DELETE FROM people WHERE id = ?", (person_id,))
    conn.commit()


def attendance_count(person_id: int) -> int:
    row = connect().execute(
        "SELECT COUNT(*) AS n FROM attendance WHERE person_id = ?", (person_id,)
    ).fetchone()
    return int(row["n"])


def list_people(
    include_inactive: bool = False, kind: Optional[str] = None
) -> list[sqlite3.Row]:
    sql = "SELECT * FROM people WHERE 1=1"
    args: list = []
    if not include_inactive:
        sql += " AND active = 1"
    if kind:
        sql += " AND kind = ?"
        args.append(kind)
    sql += " ORDER BY name COLLATE NOCASE"
    return connect().execute(sql, args).fetchall()


def get_person(person_id: int) -> Optional[sqlite3.Row]:
    return connect().execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone()


def seed_default_people() -> int:
    """Fill a brand-new database with :data:`DEFAULT_EMPLOYEES`.

    Only ever runs when there are no people at all. Seeding on any other
    condition would resurrect names the user had deliberately removed.
    """
    conn = connect()
    if conn.execute("SELECT COUNT(*) AS n FROM people").fetchone()["n"]:
        return 0

    added = 0
    for name in DEFAULT_EMPLOYEES:
        try:
            add_person(name, kind=KIND_ROSTER)
            added += 1
        except ValueError:
            continue
    return added


# --------------------------------------------------------------------------
# attendance
# --------------------------------------------------------------------------

def mark(person_id: int, day: str, status: str, reason: str = "") -> None:
    """Record a status for a person on a date, replacing any prior entry.

    The ``UNIQUE(person_id, date)`` constraint plus ``ON CONFLICT`` is what
    makes re-marking someone update their row instead of duplicating it.
    """
    if status not in STATUSES:
        raise ValueError(f"Unknown status: {status}")
    if status not in REASON_STATUSES:
        reason = ""

    conn = connect()
    conn.execute(
        """
        INSERT INTO attendance (person_id, date, status, reason, recorded_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(person_id, date) DO UPDATE SET
            status      = excluded.status,
            reason      = excluded.reason,
            recorded_at = excluded.recorded_at
        """,
        (person_id, day, status, reason.strip(), _now()),
    )
    conn.commit()


def mark_many(person_ids: Iterable[int], day: str, status: str) -> None:
    """Mark several people at once (used by 'Mark all present')."""
    for pid in person_ids:
        mark(pid, day, status, "")


def unmark(person_id: int, day: str) -> None:
    """Clear a person's entry for a day, returning them to 'not recorded'."""
    conn = connect()
    conn.execute("DELETE FROM attendance WHERE person_id = ? AND date = ?", (person_id, day))
    conn.commit()


def get_day(day: str) -> list[sqlite3.Row]:
    """Everyone relevant to a date, with their status if one was recorded.

    That means all active roster members, plus anyone else (walk-in or since
    deactivated) who actually has a record on that day — so past days always
    render exactly as they were saved.
    """
    return connect().execute(
        """
        SELECT p.id            AS person_id,
               p.name          AS name,
               p.kind          AS kind,
               p.active        AS active,
               a.status        AS status,
               a.reason        AS reason,
               a.recorded_at   AS recorded_at
        FROM people p
        LEFT JOIN attendance a ON a.person_id = p.id AND a.date = ?
        WHERE (p.active = 1 AND p.kind = ?) OR a.id IS NOT NULL
        ORDER BY p.name COLLATE NOCASE
        """,
        (day, KIND_ROSTER),
    ).fetchall()


def day_summary(day: str) -> dict:
    """Counts per status for a date, plus how many are still unrecorded."""
    rows = get_day(day)
    summary = {s: 0 for s in STATUSES}
    summary["Unrecorded"] = 0
    for row in rows:
        if row["status"] in summary:
            summary[row["status"]] += 1
        else:
            summary["Unrecorded"] += 1
    summary["Total"] = len(rows)
    return summary


def search(
    name_query: str = "",
    start: Optional[str] = None,
    end: Optional[str] = None,
    status: Optional[str] = None,
) -> list[sqlite3.Row]:
    """Attendance records filtered by name fragment, date range and status."""
    sql = """
        SELECT a.id, a.date, a.status, a.reason, a.recorded_at,
               p.id AS person_id, p.name AS name, p.kind AS kind
        FROM attendance a
        JOIN people p ON p.id = a.person_id
        WHERE 1=1
    """
    args: list = []
    if name_query.strip():
        sql += " AND p.name LIKE ? COLLATE NOCASE"
        args.append(f"%{name_query.strip()}%")
    if start:
        sql += " AND a.date >= ?"
        args.append(start)
    if end:
        sql += " AND a.date <= ?"
        args.append(end)
    if status:
        sql += " AND a.status = ?"
        args.append(status)
    sql += " ORDER BY a.date DESC, p.name COLLATE NOCASE"
    return connect().execute(sql, args).fetchall()


def person_history(person_id: int) -> list[sqlite3.Row]:
    return connect().execute(
        """
        SELECT a.date, a.status, a.reason, a.recorded_at
        FROM attendance a
        WHERE a.person_id = ?
        ORDER BY a.date DESC
        """,
        (person_id,),
    ).fetchall()


def known_reasons(limit: int = 25) -> list[str]:
    """Previously used reasons, most frequent first, for the dropdown."""
    rows = connect().execute(
        """
        SELECT reason, COUNT(*) AS n
        FROM attendance
        WHERE reason != ''
        GROUP BY reason COLLATE NOCASE
        ORDER BY n DESC, reason COLLATE NOCASE
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [r["reason"] for r in rows]


def recorded_dates() -> list[str]:
    rows = connect().execute(
        "SELECT DISTINCT date FROM attendance ORDER BY date DESC"
    ).fetchall()
    return [r["date"] for r in rows]


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

def per_person_stats(
    start: Optional[str] = None, end: Optional[str] = None
) -> list[sqlite3.Row]:
    """Per-person totals and attendance rate over an optional date range.

    Rate counts Present and Late as attended: someone who showed up late did
    show up. Absences are the figure that matters and is listed separately.
    """
    sql = """
        SELECT p.id   AS person_id,
               p.name AS name,
               p.kind AS kind,
               p.active AS active,
               COUNT(a.id) AS recorded,
               SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present,
               SUM(CASE WHEN a.status = 'Late'    THEN 1 ELSE 0 END) AS late,
               SUM(CASE WHEN a.status = 'Absent'  THEN 1 ELSE 0 END) AS absent
        FROM people p
        LEFT JOIN attendance a ON a.person_id = p.id
    """
    args: list = []
    conditions = []
    if start:
        conditions.append("a.date >= ?")
        args.append(start)
    if end:
        conditions.append("a.date <= ?")
        args.append(end)
    if conditions:
        # Filter inside the join so people with no rows in range still appear.
        sql = sql.replace(
            "LEFT JOIN attendance a ON a.person_id = p.id",
            "LEFT JOIN attendance a ON a.person_id = p.id AND " + " AND ".join(conditions),
        )
    sql += " GROUP BY p.id ORDER BY p.name COLLATE NOCASE"
    return connect().execute(sql, args).fetchall()


def reason_stats(
    start: Optional[str] = None, end: Optional[str] = None, limit: int = 20
) -> list[sqlite3.Row]:
    sql = "SELECT reason, COUNT(*) AS n FROM attendance WHERE reason != ''"
    args: list = []
    if start:
        sql += " AND date >= ?"
        args.append(start)
    if end:
        sql += " AND date <= ?"
        args.append(end)
    sql += " GROUP BY reason COLLATE NOCASE ORDER BY n DESC, reason COLLATE NOCASE LIMIT ?"
    args.append(limit)
    return connect().execute(sql, args).fetchall()


def overall_stats() -> dict:
    conn = connect()
    people = conn.execute("SELECT COUNT(*) AS n FROM people WHERE active = 1").fetchone()["n"]
    records = conn.execute("SELECT COUNT(*) AS n FROM attendance").fetchone()["n"]
    days = conn.execute("SELECT COUNT(DISTINCT date) AS n FROM attendance").fetchone()["n"]
    first = conn.execute("SELECT MIN(date) AS d FROM attendance").fetchone()["d"]
    last = conn.execute("SELECT MAX(date) AS d FROM attendance").fetchone()["d"]
    return {
        "people": people,
        "records": records,
        "days": days,
        "first_date": first,
        "last_date": last,
    }


# --------------------------------------------------------------------------
# backups
# --------------------------------------------------------------------------

def backup_now() -> Optional[Path]:
    """Write a consistent copy of the database into the backups folder.

    Uses SQLite's online backup API rather than a file copy so a backup taken
    while the app is running is never torn mid-write.
    """
    source = paths.db_path()
    if not source.exists():
        return None

    paths.ensure_dirs()
    target = paths.backup_dir() / f"attendance-{_date.today().isoformat()}.db"
    dest = sqlite3.connect(str(target))
    try:
        connect().backup(dest)
    finally:
        dest.close()
    _prune_backups()
    return target


def _prune_backups() -> None:
    backups = sorted(paths.backup_dir().glob("attendance-*.db"))
    for stale in backups[:-BACKUPS_TO_KEEP]:
        try:
            stale.unlink()
        except OSError:
            pass


def backup_if_stale() -> Optional[Path]:
    """Back up at most once per day, called on startup."""
    target = paths.backup_dir() / f"attendance-{_date.today().isoformat()}.db"
    if target.exists():
        return None
    try:
        return backup_now()
    except Exception:
        # A failed backup must never stop the app from opening.
        return None


def export_database_copy(destination: Path) -> Path:
    """Copy the database somewhere the user chose (e.g. a USB drive)."""
    backup_now()
    shutil.copy2(paths.db_path(), destination)
    return destination
