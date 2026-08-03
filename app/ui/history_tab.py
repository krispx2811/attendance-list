"""Search past records and export them."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

from .. import db, exporter, paths
from . import widgets

_ANY_STATUS = "Any status"


class HistoryTab(ctk.CTkFrame):
    COLUMNS = (
        ("date", "Date", 120),
        ("name", "Name", 220),
        ("status", "Status", 110),
        ("reason", "Reason for not coming", 380),
    )

    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        self._results: list = []

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        self._build_filters()
        self._build_quick_ranges()
        table, self.tree = widgets.make_table(
            self, self.COLUMNS, on_double_click=self._show_person_history
        )
        table.grid(row=2, column=0, sticky="nsew")
        self._build_footer()
        self.reload()

    # -- construction ----------------------------------------------------
    def _build_filters(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        bar.grid_columnconfigure(6, weight=1)

        self.name_entry = ctk.CTkEntry(bar, placeholder_text="Name contains…", width=200)
        self.name_entry.grid(row=0, column=0, padx=(0, 8))
        self.name_entry.bind("<Return>", lambda _e: self.reload())

        ctk.CTkLabel(bar, text="From").grid(row=0, column=1, padx=(0, 4))
        self.from_entry = ctk.CTkEntry(bar, placeholder_text="YYYY-MM-DD", width=120)
        self.from_entry.grid(row=0, column=2, padx=(0, 8))

        ctk.CTkLabel(bar, text="To").grid(row=0, column=3, padx=(0, 4))
        self.to_entry = ctk.CTkEntry(bar, placeholder_text="YYYY-MM-DD", width=120)
        self.to_entry.grid(row=0, column=4, padx=(0, 8))

        self.status_menu = ctk.CTkOptionMenu(
            bar, values=[_ANY_STATUS, *db.STATUSES], width=140
        )
        self.status_menu.set(_ANY_STATUS)
        self.status_menu.grid(row=0, column=5, padx=(0, 8))

        ctk.CTkButton(bar, text="Search", width=100, command=self.reload).grid(
            row=0, column=7, padx=(0, 8), sticky="e"
        )
        ctk.CTkButton(
            bar,
            text="Reset",
            width=80,
            fg_color="transparent",
            border_width=1,
            command=self._reset,
        ).grid(row=0, column=8, sticky="e")

    def _build_quick_ranges(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=1, column=0, sticky="ew", pady=(0, 8))

        ctk.CTkLabel(bar, text="Quick range:", text_color="#888888").pack(
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
                height=26,
                fg_color="transparent",
                border_width=1,
                command=lambda g=getter: self._apply_range(*g()),
            ).pack(side="left", padx=(0, 6))
        ctk.CTkButton(
            bar,
            text="All time",
            width=90,
            height=26,
            fg_color="transparent",
            border_width=1,
            command=lambda: self._apply_range("", ""),
        ).pack(side="left")

    def _build_footer(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=3, column=0, sticky="ew", pady=(8, 0))
        bar.grid_columnconfigure(0, weight=1)

        self.count_label = ctk.CTkLabel(bar, text="", anchor="w", text_color="#888888")
        self.count_label.grid(row=0, column=0, sticky="w")

        ctk.CTkButton(bar, text="Export to Excel", width=140, command=self._export_xlsx).grid(
            row=0, column=1, padx=(8, 8)
        )
        ctk.CTkButton(
            bar,
            text="Export to CSV",
            width=130,
            fg_color="transparent",
            border_width=1,
            command=self._export_csv,
        ).grid(row=0, column=2)

    # -- data ------------------------------------------------------------
    def reload(self) -> None:
        status = self.status_menu.get()
        rows = db.search(
            name_query=self.name_entry.get(),
            start=self._date_field(self.from_entry),
            end=self._date_field(self.to_entry),
            status=None if status == _ANY_STATUS else status,
        )
        self._results = rows

        display = [[r["date"], r["name"], r["status"], r["reason"] or ""] for r in rows]
        widgets.fill_table(self.tree, display, tags_for=self._tags_for)

        self.count_label.configure(
            text=f"{len(rows)} record{'s' if len(rows) != 1 else ''}"
            + ("   ·   double-click a row for that person's full history" if rows else "")
        )
        self.app.set_status(f"{len(rows)} records found")

    @staticmethod
    def _tags_for(row, _index):
        if row[2] == db.STATUS_ABSENT:
            return ["absent"]
        if row[2] == db.STATUS_LATE:
            return ["late"]
        return []

    def _date_field(self, entry) -> str | None:
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

    def _reset(self) -> None:
        self.name_entry.delete(0, "end")
        self.from_entry.delete(0, "end")
        self.to_entry.delete(0, "end")
        self.status_menu.set(_ANY_STATUS)
        self.reload()

    # -- actions ---------------------------------------------------------
    def _selected_row(self):
        selection = self.tree.selection()
        if not selection:
            return None
        index = self.tree.index(selection[0])
        return self._results[index] if index < len(self._results) else None

    def _show_person_history(self, _event=None) -> None:
        record = self._selected_row()
        if record is None:
            return
        PersonHistoryWindow(self, record["person_id"], record["name"])

    def _default_name(self, extension: str) -> str:
        start = self._date_field(self.from_entry)
        end = self._date_field(self.to_entry)
        if start or end:
            span = f"{start or 'start'}_to_{end or date.today().isoformat()}"
        else:
            span = "all"
        return f"attendance_{span}.{extension}"

    def _export_xlsx(self) -> None:
        if not self._check_has_rows():
            return
        target = filedialog.asksaveasfilename(
            parent=self,
            title="Export to Excel",
            defaultextension=".xlsx",
            initialfile=self._default_name("xlsx"),
            initialdir=str(paths.default_export_dir()),
            filetypes=[("Excel workbook", "*.xlsx")],
        )
        if not target:
            return
        try:
            exporter.export_xlsx(self._results, Path(target))
        except Exception as exc:
            messagebox.showerror("Export failed", str(exc), parent=self)
            return
        self._export_done(target)

    def _export_csv(self) -> None:
        if not self._check_has_rows():
            return
        target = filedialog.asksaveasfilename(
            parent=self,
            title="Export to CSV",
            defaultextension=".csv",
            initialfile=self._default_name("csv"),
            initialdir=str(paths.default_export_dir()),
            filetypes=[("CSV file", "*.csv")],
        )
        if not target:
            return
        try:
            exporter.export_csv(self._results, Path(target))
        except Exception as exc:
            messagebox.showerror("Export failed", str(exc), parent=self)
            return
        self._export_done(target)

    def _check_has_rows(self) -> bool:
        if self._results:
            return True
        messagebox.showinfo(
            "Nothing to export", "No records match the current filters.", parent=self
        )
        return False

    def _export_done(self, target: str) -> None:
        self.app.set_status(f"Exported {len(self._results)} records")
        messagebox.showinfo("Export complete", f"Saved to:\n{target}", parent=self)


class PersonHistoryWindow(ctk.CTkToplevel):
    """Everything recorded for one person, with their absence tally."""

    COLUMNS = (
        ("date", "Date", 130),
        ("status", "Status", 110),
        ("reason", "Reason", 380),
    )

    def __init__(self, master, person_id: int, name: str):
        super().__init__(master)
        self.title(f"History — {name}")
        self.geometry("700x520")
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        rows = db.person_history(person_id)
        present = sum(1 for r in rows if r["status"] == db.STATUS_PRESENT)
        late = sum(1 for r in rows if r["status"] == db.STATUS_LATE)
        absent = sum(1 for r in rows if r["status"] == db.STATUS_ABSENT)
        rate = ((present + late) / len(rows) * 100) if rows else 0

        header = ctk.CTkFrame(self, corner_radius=8)
        header.grid(row=0, column=0, sticky="ew", padx=12, pady=12)
        ctk.CTkLabel(
            header, text=name, font=ctk.CTkFont(size=18, weight="bold"), anchor="w"
        ).pack(side="left", padx=14, pady=(10, 2))
        ctk.CTkLabel(
            header,
            text=(
                f"Present {present}   ·   Late {late}   ·   Absent {absent}"
                f"   ·   Attendance {rate:.0f}%"
            ),
            anchor="e",
        ).pack(side="right", padx=14, pady=(10, 2))

        table, tree = widgets.make_table(self, self.COLUMNS)
        table.grid(row=1, column=0, sticky="nsew", padx=12, pady=(0, 12))
        widgets.fill_table(
            tree,
            [[r["date"], r["status"], r["reason"] or ""] for r in rows],
            tags_for=lambda row, _i: (
                ["absent"] if row[1] == db.STATUS_ABSENT
                else ["late"] if row[1] == db.STATUS_LATE
                else []
            ),
        )

        ctk.CTkButton(self, text="Close", width=100, command=self.destroy).grid(
            row=2, column=0, pady=(0, 12)
        )

        # Toplevels created before the main window finishes drawing can end up
        # behind it; a short delay makes grab_set reliable.
        self.after(120, self._focus)

    def _focus(self) -> None:
        self.lift()
        self.focus_force()
        try:
            self.grab_set()
        except Exception:
            pass
