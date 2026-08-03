"""Filesystem locations used by the application.

The database deliberately lives in the per-user application data directory and
never beside the executable: the ``.exe`` is replaced wholesale by the updater
and may sit in a read-only location such as ``C:\\Program Files``.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from .version import APP_NAME

_DIR_NAME = "AttendanceList"


def is_frozen() -> bool:
    """True when running from a PyInstaller bundle rather than source."""
    return bool(getattr(sys, "frozen", False))


#: Overrides the data location. Useful for tests and for pointing an install
#: at a shared drive so several PCs read one attendance database.
ENV_DATA_DIR = "ATTENDANCE_DATA_DIR"


def data_dir() -> Path:
    """Per-user directory holding the database, backups and settings."""
    override = os.environ.get(ENV_DATA_DIR)
    if override:
        return Path(override).expanduser()

    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / _DIR_NAME


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


def describe_data_location() -> str:
    """Human-readable data location, shown in the UI so users can find it."""
    return f"{APP_NAME} data: {data_dir()}"
