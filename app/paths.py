"""Filesystem locations used by the application.

The database lives in a ``data`` folder beside the application itself, so
everything to do with attendance sits in one place you can see, copy or back
up by hand.

Replacing the executable during an update does not disturb that folder — the
updater swaps a single file. The one case the folder cannot be used is an
install location the user cannot write to (``C:\\Program Files``, or running
from a locked-down network share), so :func:`data_dir` probes for writability
once and falls back to the per-user application data directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

from .version import APP_NAME

_DIR_NAME = "AttendanceList"
_DATA_FOLDER = "data"

_resolved_data_dir: Optional[Path] = None


def is_frozen() -> bool:
    """True when running from a PyInstaller bundle rather than source."""
    return bool(getattr(sys, "frozen", False))


#: Overrides the data location. Useful for tests and for pointing an install
#: at a shared drive so several PCs read one attendance database.
ENV_DATA_DIR = "ATTENDANCE_DATA_DIR"


def app_dir() -> Path:
    """The folder the app lives in — next to the .exe, or the project root."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def user_data_dir() -> Path:
    """Per-user fallback, used only when :func:`app_dir` is not writable."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / _DIR_NAME


def _is_writable(candidate: Path) -> bool:
    """Can we actually create files here? Permissions alone lie on Windows."""
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        probe = candidate / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except Exception:
        return False


def data_dir() -> Path:
    """Where the database and backups live.

    Beside the app by default; the result is resolved once and cached so the
    writability probe does not run on every call.
    """
    override = os.environ.get(ENV_DATA_DIR)
    if override:
        return Path(override).expanduser()

    global _resolved_data_dir
    if _resolved_data_dir is not None:
        return _resolved_data_dir

    beside_app = app_dir() / _DATA_FOLDER
    _resolved_data_dir = beside_app if _is_writable(beside_app) else user_data_dir()
    return _resolved_data_dir


def using_fallback_location() -> bool:
    """True when the app folder was read-only and we fell back."""
    return data_dir() != app_dir() / _DATA_FOLDER


def db_path() -> Path:
    return data_dir() / "attendance.db"


def backup_dir() -> Path:
    return data_dir() / "backups"


def default_export_dir() -> Path:
    """Where export dialogs open by default."""
    downloads = Path.home() / "Downloads"
    return downloads if downloads.is_dir() else Path.home()


def log_path() -> Path:
    return data_dir() / "app.log"


def resource_path(relative: str) -> Path:
    """Resolve a bundled read-only resource (icons, themes).

    PyInstaller unpacks one-file bundles into ``sys._MEIPASS`` at runtime.
    """
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / relative


def ensure_dirs() -> None:
    """Create the directories the app writes to. Safe to call repeatedly."""
    data_dir().mkdir(parents=True, exist_ok=True)
    backup_dir().mkdir(parents=True, exist_ok=True)


def adopt_legacy_database() -> Optional[Path]:
    """Move a database left in the old per-user location into the app folder.

    Earlier builds stored data under Application Support / LOCALAPPDATA. If
    one is found and the new location is still empty, bring it across so no
    attendance history is stranded. The original is renamed rather than
    deleted, so a mistake here is recoverable.
    """
    target = db_path()
    if target.exists() or os.environ.get(ENV_DATA_DIR):
        return None

    legacy = user_data_dir() / "attendance.db"
    if not legacy.exists() or legacy.parent == data_dir():
        return None

    try:
        ensure_dirs()
        # SQLite's backup API rather than a file copy: the database runs in
        # WAL mode, so recent writes may live in the -wal sidecar. Copying
        # only the .db would silently drop them.
        import sqlite3

        source = sqlite3.connect(str(legacy))
        destination = sqlite3.connect(str(target))
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()

        legacy.rename(legacy.with_suffix(".db.migrated"))
        for suffix in ("-wal", "-shm"):
            leftover = legacy.with_name(legacy.name + suffix)
            if leftover.exists():
                leftover.unlink()
        return target
    except Exception:
        # Never let a migration problem stop the app from opening.
        return None


def describe_data_location() -> str:
    """Human-readable data location, shown in the UI so users can find it."""
    return f"{APP_NAME} data: {data_dir()}"
