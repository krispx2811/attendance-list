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

_ROW_BG = widgets.CARD_BG
_ROW_BG_MARKED = ("#ffffff", "#34383d")


class PersonRow(ctk.CTkFrame):
    """One person's row: avatar, name, status buttons and a reason field."""

    def __init__(self, master, tab: "TodayTab", person_id: int, name: str, kind: str):
        super().__init__(master, corner_radius=10, fg_color=_ROW_BG)
        self.tab = tab
        self.person_id = person_id
        self.person_name = name

        self.grid_columnconfigure(2, weight=1, minsize=170)
        self.grid_columnconfigure(4, weight=2, minsize=200)

        # Thin colour bar on the left edge, tinted by status. height=1 matters:
        # CTkFrame defaults to 200px tall, which would set the whole row height.
        self.accent = ctk.CTkFrame(
            self, width=4, height=1, corner_radius=2, fg_color="transparent"
        )
        self.accent.grid(row=0, column=0, sticky="ns", padx=(8, 0), pady=10)

        self.avatar = widgets.Avatar(self, name, size=38)
        self.avatar.grid(row=0, column=1, padx=(12, 12), pady=10)

        names = ctk.CTkFrame(self, fg_color="transparent")
        names.grid(row=0, column=2, sticky="ew", pady=10)
        ctk.CTkLabel(
            names, text=name, anchor="w", font=ctk.CTkFont(size=15, weight="bold")
        ).pack(anchor="w")
        self.subtitle = ctk.CTkLabel(
            names,
            text="Guest" if kind == db.KIND_WALKIN else "Not recorded yet",
            anchor="w",
            font=ctk.CTkFont(size=11),
            text_color=widgets.MUTED,
        )
        self.subtitle.pack(anchor="w")
        self.is_guest = kind == db.KIND_WALKIN

        self.status = ctk.CTkSegmentedButton(
            self,
            values=[db.STATUS_PRESENT, db.STATUS_LATE, db.STATUS_ABSENT],
            command=self._on_status,
            width=270,
            height=34,
            font=ctk.CTkFont(size=13, weight="bold"),
        )
        self.status.grid(row=0, column=3, padx=10, pady=10)

        self.reason = ctk.CTkComboBox(
            self, values=[], width=240, height=34, command=self._on_reason_selected
        )
        self.reason.grid(row=0, column=4, sticky="ew", padx=10, pady=10)
        # Bind the inner entry: the combobox itself is a frame and never gets
        # keyboard focus, so <FocusOut> on it would never fire.
        self._reason_entry = getattr(self.reason, "_entry", self.reason)
        self._reason_entry.bind("<Return>", self._on_reason_committed)
        self._reason_entry.bind("<FocusOut>", self._on_reason_committed)

        self.clear_btn = ctk.CTkButton(
            self,
            text="✕",
            width=30,
            height=30,
            fg_color="transparent",
            hover_color=("#dfe1e5", "#3d4247"),
            text_color=widgets.MUTED,
            command=self._on_clear,
        )
        self.clear_btn.grid(row=0, column=5, padx=(4, 12), pady=10)

        self._current_status = _UNSET
        self._current_reason = ""

    # -- state -----------------------------------------------------------
    def load(self, status: Optional[str], reason: Optional[str], reasons: list[str]) -> None:
        self._current_status = status or _UNSET
        self._current_reason = reason or ""

        self.status.set(self._current_status)
        self.reason.configure(values=reasons or [])
        self.reason.set(self._current_reason)
        self._sync_appearance()

    def _sync_appearance(self) -> None:
        """Recolour the row and enable the reason field to match the status."""
        status = self._current_status
        fill = widgets.STATUS_FILL.get(status)

        if fill:
            self.status.configure(selected_color=fill[0], selected_hover_color=fill[1])
            self.accent.configure(fg_color=fill[0])
            self.configure(fg_color=_ROW_BG_MARKED)
            label = status if not self.is_guest else f"Guest · {status}"
            self.subtitle.configure(text=label, text_color=fill[0])
        else:
            self.accent.configure(fg_color="transparent")
            self.configure(fg_color=_ROW_BG)
            self.subtitle.configure(
                text="Guest" if self.is_guest else "Not recorded yet",
                text_color=widgets.MUTED,
            )

        # A reason only applies to Absent and Late.
        if status in db.REASON_STATUSES:
            self.reason.configure(state="normal")
            placeholder = (
                "Why were they late?" if status == db.STATUS_LATE
                else "Reason for not coming"
            )
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
        self._sync_appearance()
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
        self._sync_appearance()
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
        self._build_stats()
        self._build_toolbar()
        self._build_list()
        self.reload()

    # -- construction ----------------------------------------------------
    def _build_header(self) -> None:
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        header.grid_columnconfigure(1, weight=1)

        left = ctk.CTkFrame(header, fg_color="transparent")
        left.grid(row=0, column=0, sticky="w")

        self.long_date = ctk.CTkLabel(
            left, text="", font=ctk.CTkFont(size=24, weight="bold"), anchor="w"
        )
        self.long_date.pack(anchor="w")
        self.day_note = ctk.CTkLabel(
            left, text="", anchor="w", font=ctk.CTkFont(size=12),
            text_color=widgets.MUTED,
        )
        self.day_note.pack(anchor="w")

        self.date_picker = widgets.DatePicker(header, on_change=self._on_date_change)
        self.date_picker.grid(row=0, column=2, sticky="e")

    def _build_stats(self) -> None:
        row = ctk.CTkFrame(self, fg_color="transparent")
        row.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        for i in range(4):
            row.grid_columnconfigure(i, weight=1)

        self.cards = {
            db.STATUS_PRESENT: widgets.StatCard(row, "Present", widgets.STATUS_FILL["Present"][0]),
            db.STATUS_LATE: widgets.StatCard(row, "Late", widgets.STATUS_FILL["Late"][0]),
            db.STATUS_ABSENT: widgets.StatCard(row, "Absent", widgets.STATUS_FILL["Absent"][0]),
            "Unrecorded": widgets.StatCard(row, "Not recorded", widgets.MUTED),
        }
        for index, card in enumerate(self.cards.values()):
            card.grid(row=0, column=index, sticky="ew", padx=(0 if index == 0 else 8, 0))

    def _build_toolbar(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=2, column=0, sticky="ew", pady=(0, 10))
        bar.grid_columnconfigure(3, weight=1)

        ctk.CTkButton(
            bar, text="✓  Mark everyone present", width=200, height=34,
            font=ctk.CTkFont(size=13, weight="bold"),
            fg_color=widgets.STATUS_FILL["Present"][0],
            hover_color=widgets.STATUS_FILL["Present"][1],
            command=self._mark_all_present,
        ).grid(row=0, column=0, padx=(0, 8))

        ctk.CTkButton(
            bar, text="+  Add employees", width=150, height=34,
            command=self._add_employees,
        ).grid(row=0, column=1, padx=(0, 8))

        ctk.CTkButton(
            bar, text="+  Add guest", width=120, height=34,
            fg_color="transparent", border_width=1, command=self._add_walkin,
        ).grid(row=0, column=2, padx=(0, 8))

        self.search_entry = ctk.CTkEntry(
            bar, placeholder_text="Search names…", width=220, height=34
        )
        self.search_entry.grid(row=0, column=4, sticky="e", padx=(0, 8))
        self.search_entry.bind("<KeyRelease>", self._on_filter)

        ctk.CTkButton(
            bar, text="Clear day", width=100, height=34,
            fg_color="transparent", border_width=1, text_color=widgets.MUTED,
            command=self._clear_day,
        ).grid(row=0, column=5, sticky="e")

    def _build_list(self) -> None:
        self.list_frame = ctk.CTkScrollableFrame(self, label_text="", fg_color="transparent")
        self.list_frame.grid(row=3, column=0, sticky="nsew")
        self.list_frame.grid_columnconfigure(0, weight=1)

        self.empty_state = ctk.CTkFrame(self.list_frame, fg_color="transparent")
        ctk.CTkLabel(
            self.empty_state, text="👥", font=ctk.CTkFont(size=52)
        ).pack(pady=(50, 10))
        ctk.CTkLabel(
            self.empty_state,
            text="No employees yet",
            font=ctk.CTkFont(size=20, weight="bold"),
        ).pack()
        ctk.CTkLabel(
            self.empty_state,
            text="Add everyone once, then each day you just mark who came in.",
            text_color=widgets.MUTED,
            justify="center",
        ).pack(pady=(6, 18))
        ctk.CTkButton(
            self.empty_state,
            text="+  Add your employees",
            width=210,
            height=40,
            font=ctk.CTkFont(size=14, weight="bold"),
            command=self._add_employees,
        ).pack()

        self.no_match = ctk.CTkLabel(
            self.list_frame, text="", text_color=widgets.MUTED
        )

    # -- data ------------------------------------------------------------
    def reload(self) -> None:
        """Rebuild the whole list for the current date."""
        for row in self._rows.values():
            row.destroy()
        self._rows.clear()
        self.empty_state.grid_forget()
        self.no_match.grid_forget()

        self._reasons = db.known_reasons()
        records = db.get_day(self.current_day)
        visible = [
            r for r in records if not self._filter or self._filter in r["name"].lower()
        ]

        if not records:
            self.empty_state.grid(row=0, column=0, pady=20)
        elif not visible:
            self.no_match.configure(text=f"No one matches “{self._filter}”.")
            self.no_match.grid(row=0, column=0, pady=60)
        else:
            for index, record in enumerate(visible):
                row = PersonRow(
                    self.list_frame, self, record["person_id"],
                    record["name"], record["kind"],
                )
                row.grid(row=index, column=0, sticky="ew", pady=3, padx=2)
                row.load(record["status"], record["reason"], self._reasons)
                self._rows[record["person_id"]] = row

        self.long_date.configure(
            text=widgets.format_long_date(date.fromisoformat(self.current_day))
        )
        today = db.today_str()
        if self.current_day == today:
            self.day_note.configure(text="Today")
        elif self.current_day < today:
            self.day_note.configure(text="Filling in a past day")
        else:
            self.day_note.configure(text="A future date")

        self.refresh_summary()

    def refresh_summary(self) -> None:
        summary = db.day_summary(self.current_day)
        for key, card in self.cards.items():
            card.set_value(summary[key])
        self.app.set_status(
            f"{self.current_day} — {summary['Total']} people, "
            f"{summary['Unrecorded']} still to record"
        )

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
        if not records:
            self._add_employees()
            return
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

    def _add_employees(self) -> None:
        widgets.BulkAddDialog(self, on_done=self._create_employees)

    def _create_employees(self, names: list[str]) -> None:
        added = 0
        for name in names:
            try:
                db.add_person(name, kind=db.KIND_ROSTER)
                added += 1
            except ValueError:
                continue
        self._filter = ""
        self.search_entry.delete(0, "end")
        self.reload()
        self.app.refresh_other_tabs(source="today")
        self.app.set_status(f"Added {added} employee{'s' if added != 1 else ''}")

    def _add_walkin(self) -> None:
        dialog = ctk.CTkInputDialog(
            text="Name of the guest to add for today:", title="Add guest"
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
