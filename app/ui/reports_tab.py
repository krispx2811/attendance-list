"""Summary statistics, backups and update controls."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

from .. import db, exporter, paths
from . import widgets


class ReportsTab(ctk.CTkFrame):
    PEOPLE_COLUMNS = (
        ("name", "Name", 220),
        ("recorded", "Days recorded", 120),
        ("present", "Present", 90),
        ("late", "Late", 80),
        ("absent", "Absent", 90),
        ("rate", "Attendance", 110),
    )
    REASON_COLUMNS = (
        ("reason", "Reason", 320),
        ("count", "Times given", 110),
    )

    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        self._stats: list = []
        self._reasons: list = []

        self.grid_columnconfigure(0, weight=3)
        self.grid_columnconfigure(1, weight=2)
        self.grid_rowconfigure(2, weight=1)

        self._build_filters()
        self._build_overview()
        self._build_tables()
        self._build_actions()
        self.reload()

    # -- construction ----------------------------------------------------
    def _build_filters(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 8))

        ctk.CTkLabel(bar, text="From").pack(side="left", padx=(0, 4))
        self.from_entry = ctk.CTkEntry(bar, placeholder_text="YYYY-MM-DD", width=120)
        self.from_entry.pack(side="left", padx=(0, 8))

        ctk.CTkLabel(bar, text="To").pack(side="left", padx=(0, 4))
        self.to_entry = ctk.CTkEntry(bar, placeholder_text="YYYY-MM-DD", width=120)
        self.to_entry.pack(side="left", padx=(0, 8))

        ctk.CTkButton(bar, text="Apply", width=90, command=self.reload).pack(
            side="left", padx=(0, 8)
        )
        for label, getter in (
            ("This week", widgets.week_bounds),
            ("This month", widgets.month_bounds),
        ):
            ctk.CTkButton(
                bar,
                text=label,
                width=100,
                fg_color="transparent",
                border_width=1,
                command=lambda g=getter: self._apply_range(*g()),
            ).pack(side="left", padx=(0, 6))
        ctk.CTkButton(
            bar,
            text="All time",
            width=90,
            fg_color="transparent",
            border_width=1,
            command=lambda: self._apply_range("", ""),
        ).pack(side="left")

    def _build_overview(self) -> None:
        self.overview = ctk.CTkFrame(self, corner_radius=8)
        self.overview.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(0, 8))
        self.overview_label = ctk.CTkLabel(
            self.overview, text="", anchor="w", justify="left", font=ctk.CTkFont(size=13)
        )
        self.overview_label.pack(side="left", padx=14, pady=10)

    def _build_tables(self) -> None:
        people_table, self.people_tree = widgets.make_table(self, self.PEOPLE_COLUMNS)
        people_table.grid(row=2, column=0, sticky="nsew", padx=(0, 8))

        reason_table, self.reason_tree = widgets.make_table(self, self.REASON_COLUMNS)
        reason_table.grid(row=2, column=1, sticky="nsew")

    def _build_actions(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(8, 0))

        ctk.CTkButton(
            bar, text="Export full report", width=160, command=self._export_report
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            bar,
            text="Back up now",
            width=120,
            fg_color="transparent",
            border_width=1,
            command=self._backup,
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            bar,
            text="Save a copy of the data",
            width=180,
            fg_color="transparent",
            border_width=1,
            command=self._save_copy,
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            bar,
            text="Open data folder",
            width=150,
            fg_color="transparent",
            border_width=1,
            command=self._open_folder,
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            bar,
            text="Check for updates",
            width=150,
            fg_color="transparent",
            border_width=1,
            command=self.app.check_for_updates_now,
        ).pack(side="right")

    # -- data ------------------------------------------------------------
    def reload(self) -> None:
        start = self._date_field(self.from_entry)
        end = self._date_field(self.to_entry)

        self._stats = db.per_person_stats(start, end)
        self._reasons = db.reason_stats(start, end)

        display = []
        for s in self._stats:
            recorded = s["recorded"] or 0
            attended = (s["present"] or 0) + (s["late"] or 0)
            rate = f"{attended / recorded * 100:.0f}%" if recorded else "—"
            display.append(
                [
                    s["name"] + ("" if s["active"] else "  (removed)"),
                    recorded,
                    s["present"] or 0,
                    s["late"] or 0,
                    s["absent"] or 0,
                    rate,
                ]
            )
        widgets.fill_table(
            self.people_tree,
            display,
            tags_for=lambda row, _i: ["absent"] if row[4] else [],
        )

        widgets.fill_table(
            self.reason_tree, [[r["reason"], r["n"]] for r in self._reasons]
        )

        self._render_overview(start, end)

    def _render_overview(self, start, end) -> None:
        overall = db.overall_stats()
        rows = db.search(start=start, end=end)
        total = len(rows)
        absent = sum(1 for r in rows if r["status"] == db.STATUS_ABSENT)
        late = sum(1 for r in rows if r["status"] == db.STATUS_LATE)
        attended = total - absent
        rate = f"{attended / total * 100:.0f}%" if total else "—"

        span = "all time"
        if start or end:
            span = f"{start or 'the beginning'} → {end or 'today'}"

        first = overall["first_date"] or "—"
        last = overall["last_date"] or "—"
        self.overview_label.configure(
            text=(
                f"Range: {span}   ·   {total} records   ·   overall attendance {rate}"
                f"   ·   {absent} absences   ·   {late} late\n"
                f"Database: {overall['people']} active people   ·   "
                f"{overall['days']} days recorded   ·   {first} to {last}"
            )
        )

    def _date_field(self, entry):
        parsed = widgets.parse_date(entry.get())
        return parsed.isoformat() if parsed else None

    def _apply_range(self, start: str, end: str) -> None:
        self.from_entry.delete(0, "end")
        self.to_entry.delete(0, "end")
        if start:
            self.from_entry.insert(0, start)
        if end:
            self.to_entry.insert(0, end)
        self.reload()

    # -- actions ---------------------------------------------------------
    def _export_report(self) -> None:
        start = self._date_field(self.from_entry)
        end = self._date_field(self.to_entry)
        rows = db.search(start=start, end=end)
        if not rows:
            messagebox.showinfo(
                "Nothing to export", "No records in the selected range.", parent=self
            )
            return

        target = filedialog.asksaveasfilename(
            parent=self,
            title="Export full report",
            defaultextension=".xlsx",
            initialfile="attendance_report.xlsx",
            initialdir=str(paths.default_export_dir()),
            filetypes=[("Excel workbook", "*.xlsx")],
        )
        if not target:
            return
        try:
            exporter.export_summary_xlsx(rows, self._stats, self._reasons, Path(target))
        except Exception as exc:
            messagebox.showerror("Export failed", str(exc), parent=self)
            return
        messagebox.showinfo(
            "Export complete",
            f"Saved to:\n{target}\n\nSheets: Records, Summary, Reasons.",
            parent=self,
        )

    def _backup(self) -> None:
        try:
            target = db.backup_now()
        except Exception as exc:
            messagebox.showerror("Backup failed", str(exc), parent=self)
            return
        if target is None:
            messagebox.showinfo("Nothing to back up", "No database yet.", parent=self)
            return
        messagebox.showinfo("Backup complete", f"Saved to:\n{target}", parent=self)

    def _save_copy(self) -> None:
        target = filedialog.asksaveasfilename(
            parent=self,
            title="Save a copy of the data",
            defaultextension=".db",
            initialfile=f"attendance-{db.today_str()}.db",
            initialdir=str(paths.default_export_dir()),
            filetypes=[("Database file", "*.db")],
        )
        if not target:
            return
        try:
            db.export_database_copy(Path(target))
        except Exception as exc:
            messagebox.showerror("Copy failed", str(exc), parent=self)
            return
        messagebox.showinfo("Copy saved", f"Saved to:\n{target}", parent=self)

    def _open_folder(self) -> None:
        folder = paths.data_dir()
        try:
            if sys.platform == "win32":
                subprocess.Popen(["explorer", str(folder)])
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(folder)])
            else:
                subprocess.Popen(["xdg-open", str(folder)])
        except Exception:
            messagebox.showinfo("Data folder", str(folder), parent=self)
