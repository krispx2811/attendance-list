"""Application entry point."""

from __future__ import annotations

import sys
import traceback


def main() -> int:
    from app import db, paths

    paths.ensure_dirs()
    paths.adopt_legacy_database()  # carry over data from pre-1.0.1 installs
    db.connect()
    db.backup_if_stale()

    from app.ui.app import AttendanceApp

    app = AttendanceApp()
    app.mainloop()
    db.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # A frozen build has no console, so surface the traceback in a dialog
        # and to the log rather than dying silently.
        details = traceback.format_exc()
        try:
            from app import paths

            paths.log_path().write_text(details, encoding="utf-8")
        except Exception:
            pass
        try:
            import tkinter.messagebox as mb
            import tkinter as tk

            root = tk.Tk()
            root.withdraw()
            mb.showerror("Attendance List — startup error", details)
        except Exception:
            print(details, file=sys.stderr)
        sys.exit(1)
