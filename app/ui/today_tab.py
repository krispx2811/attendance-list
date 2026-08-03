"""The daily marking screen — the one people use every morning.

Everything auto-saves. There is no Save button because a half-entered day
that was never saved is the worst possible failure for this kind of app.
"""

from __future__ import annotations

from datetime import date
from tkinter import messagebox
from typing import Optional

import customtkinter as ctk

from .. import db
from . import widgets

_UNSET = ""


class PersonRow(ctk.CTkFrame):
    """One person's row: name, status buttons and a reason field."""

    def __init__(self, master, tab: "TodayTab", person_id: int, name: str, kind: str):
        super().__init__(master, corner_radius=6)
        self.tab = tab
        self.person_id = person_id
        self.person_name = name

        self.grid_columnconfigure(0, weight=1, minsize=180)
        self.grid_columnconfigure(2, weight=2, minsize=220)

        label_text = name if kind == db.KIND_ROSTER else f"{name}  ·  walk-in"
        self.name_label = ctk.CTkLabel(
            self, text=label_text, anchor="w", font=ctk.CTkFont(size=14)
        )
        self.name_label.grid(row=0, column=0, sticky="ew", padx=(12, 8), pady=8)

        self.status = ctk.CTkSegmentedButton(
            self,
            values=[db.STATUS_PRESENT, db.STATUS_LATE, db.STATUS_ABSENT],
            command=self._on_status,
            width=260,
        )
        self.status.grid(row=0, column=1, padx=8, pady=8)

        self.reason = ctk.CTkComboBox(
            self,
            values=[],
            width=240,
            command=self._on_reason_selected,
        )
        self.reason.grid(row=0, column=2, sticky="ew", padx=8, pady=8)
        # Bind the inner entry: the combobox itself is a frame and never gets
        # keyboard focus, so <FocusOut> on it would never fire.
        self._reason_entry = getattr(self.reason, "_entry", self.reason)
        self._reason_entry.bind("<Return>", self._on_reason_committed)
        self._reason_entry.bind("<FocusOut>", self._on_reason_committed)

        self.clear_btn = ctk.CTkButton(
            self,
            text="✕",
            width=32,
            fg_color="transparent",
            border_width=1,
            command=self._on_clear,
        )
        self.clear_btn.grid(row=0, column=3, padx=(4, 12), pady=8)

        self._current_status = _UNSET
        self._current_reason = ""

    # -- state -----------------------------------------------------------
    def load(self, status: Optional[str], reason: Optional[str], reasons: list[str]) -> None:
        self._current_status = status or _UNSET
        self._current_reason = reason or ""

        self.status.set(self._current_status)
        self.reason.configure(values=reasons or [])
        self.reason.set(self._current_reason)
        self._sync_reason_state()

    def _sync_reason_state(self) -> None:
        """A reason only applies to Absent and Late."""
        if self._current_status in db.REASON_STATUSES:
            self.reason.configure(state="normal")
            placeholder = "Reason for not coming"
            if self._current_status == db.STATUS_LATE:
                placeholder = "Reason for being late"
            if not self._current_reason:
                self.reason.set("")
            try:
                self._reason_entry.configure(placeholder_text=placeholder)
            except Exception:
                pass  # cosmetic only
        else:
            self.reason.set("")
            self.reason.configure(state="disabled")

    # -- events ----------------------------------------------------------
    def _on_status(self, value: str) -> None:
        self._current_status = value
        if value not in db.REASON_STATUSES:
            self._current_reason = ""
        self._sync_reason_state()
        db.mark(self.person_id, self.tab.current_day, value, self._current_reason)
        self.tab.refresh_summary()
        if value in db.REASON_STATUSES:
            self.reason.focus_set()

    def _on_reason_selected(self, value: str) -> None:
        self._save_reason(value)

    def _on_reason_committed(self, _event=None) -> None:
        self._save_reason(self.reason.get())

    def _save_reason(self, value: str) -> None:
        if self._current_status not in db.REASON_STATUSES:
            return
        value = (value or "").strip()
        if value == self._current_reason:
            return
        self._current_reason = value
        db.mark(self.person_id, self.tab.current_day, self._current_status, value)
        self.tab.refresh_reason_options()

    def _on_clear(self) -> None:
        db.unmark(self.person_id, self.tab.current_day)
        self._current_status = _UNSET
        self._current_reason = ""
        self.status.set(_UNSET)
        self._sync_reason_state()
        self.tab.refresh_summary()


class TodayTab(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        self.current_day = db.today_str()
        self._rows: dict[int, PersonRow] = {}
        self._reasons: list[str] = []
        self._filter = ""

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(3, weight=1)

        self._build_header()
        self._build_toolbar()
        self._build_summary()
        self._build_list()
        self.reload()

    # -- construction ----------------------------------------------------
    def _build_header(self) -> None:
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        header.grid_columnconfigure(1, weight=1)

        self.date_picker = widgets.DatePicker(header, on_change=self._on_date_change)
        self.date_picker.grid(row=0, column=0, sticky="w")

        self.long_date = ctk.CTkLabel(
            header, text="", font=ctk.CTkFont(size=18, weight="bold"), anchor="e"
        )
        self.long_date.grid(row=0, column=1, sticky="e", padx=12)

    def _build_toolbar(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        bar.grid_columnconfigure(3, weight=1)

        ctk.CTkButton(
            bar, text="Mark everyone present", width=180, command=self._mark_all_present
        ).grid(row=0, column=0, padx=(0, 8))
        ctk.CTkButton(
            bar, text="+ Add walk-in", width=130, command=self._add_walkin
        ).grid(row=0, column=1, padx=(0, 8))
        ctk.CTkButton(
            bar,
            text="Clear this day",
            width=120,
            fg_color="transparent",
            border_width=1,
            command=self._clear_day,
        ).grid(row=0, column=2, padx=(0, 8))

        self.search_entry = ctk.CTkEntry(bar, placeholder_text="Filter names…", width=220)
        self.search_entry.grid(row=0, column=4, sticky="e")
        self.search_entry.bind("<KeyRelease>", self._on_filter)

    def _build_summary(self) -> None:
        self.summary_frame = ctk.CTkFrame(self, corner_radius=8)
        self.summary_frame.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        self.summary_label = ctk.CTkLabel(
            self.summary_frame, text="", anchor="w", font=ctk.CTkFont(size=13)
        )
        self.summary_label.pack(side="left", padx=14, pady=10)

    def _build_list(self) -> None:
        self.list_frame = ctk.CTkScrollableFrame(self, label_text="")
        self.list_frame.grid(row=3, column=0, sticky="nsew")
        self.list_frame.grid_columnconfigure(0, weight=1)

        self.empty_label = ctk.CTkLabel(
            self.list_frame,
            text=(
                "No one on the roster yet.\n\n"
                "Add people in the Roster tab, or use “+ Add walk-in” above."
            ),
            justify="center",
            text_color="#888888",
        )

    # -- data ------------------------------------------------------------
    def reload(self) -> None:
        """Rebuild the whole list for the current date."""
        for row in self._rows.values():
            row.destroy()
        self._rows.clear()
        self.empty_label.grid_forget()

        self._reasons = db.known_reasons()
        records = db.get_day(self.current_day)

        visible = [
            r for r in records
            if not self._filter or self._filter in r["name"].lower()
        ]

        if not visible:
            self.empty_label.grid(row=0, column=0, pady=60)
        else:
            for index, record in enumerate(visible):
                row = PersonRow(
                    self.list_frame,
                    self,
                    record["person_id"],
                    record["name"],
                    record["kind"],
                )
                row.grid(row=index, column=0, sticky="ew", pady=3, padx=4)
                row.load(record["status"], record["reason"], self._reasons)
                self._rows[record["person_id"]] = row

        self.long_date.configure(
            text=widgets.format_long_date(date.fromisoformat(self.current_day))
        )
        self.refresh_summary()

    def refresh_summary(self) -> None:
        summary = db.day_summary(self.current_day)
        self.summary_label.configure(
            text=(
                f"Present {summary[db.STATUS_PRESENT]}   ·   "
                f"Late {summary[db.STATUS_LATE]}   ·   "
                f"Absent {summary[db.STATUS_ABSENT]}   ·   "
                f"Not recorded {summary['Unrecorded']}   ·   "
                f"{summary['Total']} people"
            )
        )
        self.app.set_status(f"Showing {self.current_day}")

    def refresh_reason_options(self) -> None:
        """Keep the reason dropdowns offering previously-used reasons."""
        self._reasons = db.known_reasons()
        for row in self._rows.values():
            current = row.reason.get()
            row.reason.configure(values=self._reasons)
            row.reason.set(current)

    # -- events ----------------------------------------------------------
    def _on_date_change(self, value: date) -> None:
        self.current_day = value.isoformat()
        self.reload()

    def _on_filter(self, _event=None) -> None:
        self._filter = self.search_entry.get().strip().lower()
        self.reload()

    def _mark_all_present(self) -> None:
        records = db.get_day(self.current_day)
        unrecorded = [r["person_id"] for r in records if not r["status"]]
        if not unrecorded:
            messagebox.showinfo(
                "Nothing to do",
                "Everyone already has a status for this day.",
                parent=self,
            )
            return
        db.mark_many(unrecorded, self.current_day, db.STATUS_PRESENT)
        self.reload()

    def _clear_day(self) -> None:
        if not messagebox.askyesno(
            "Clear this day",
            f"Remove every attendance record for {self.current_day}?\n\n"
            "Other days are not affected.",
            parent=self,
        ):
            return
        for record in db.get_day(self.current_day):
            if record["status"]:
                db.unmark(record["person_id"], self.current_day)
        self.reload()

    def _add_walkin(self) -> None:
        dialog = ctk.CTkInputDialog(
            text="Name of the person to add for today:", title="Add walk-in"
        )
        name = (dialog.get_input() or "").strip()
        if not name:
            return
        try:
            person_id = db.add_person(name, kind=db.KIND_WALKIN)
        except ValueError as exc:
            messagebox.showerror("Could not add", str(exc), parent=self)
            return
        db.mark(person_id, self.current_day, db.STATUS_PRESENT, "")
        self._filter = ""
        self.search_entry.delete(0, "end")
        self.reload()
        self.app.refresh_other_tabs(source="today")
