"""Manage the list of people.

Removing someone defaults to deactivation, not deletion: an ex-employee's
past attendance is usually the thing you most need to keep.
"""

from __future__ import annotations

from tkinter import messagebox

import customtkinter as ctk

from .. import db
from . import widgets


class RosterTab(ctk.CTkFrame):
    COLUMNS = (
        ("name", "Name", 260),
        ("kind", "Type", 110),
        ("state", "Status", 110),
        ("records", "Days recorded", 130),
    )

    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        self._rows: list = []

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_toolbar()
        table, self.tree = widgets.make_table(
            self, self.COLUMNS, on_double_click=self._rename
        )
        table.grid(row=1, column=0, sticky="nsew")
        self._build_actions()
        self.reload()

    def _build_toolbar(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        bar.grid_columnconfigure(2, weight=1)

        self.name_entry = ctk.CTkEntry(bar, placeholder_text="New person's name", width=260)
        self.name_entry.grid(row=0, column=0, padx=(0, 8))
        self.name_entry.bind("<Return>", lambda _e: self._add())

        ctk.CTkButton(bar, text="Add to roster", width=130, command=self._add).grid(
            row=0, column=1
        )

        self.show_inactive = ctk.CTkCheckBox(
            bar, text="Show removed people", command=self.reload
        )
        self.show_inactive.grid(row=0, column=3, sticky="e")

    def _build_actions(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=2, column=0, sticky="ew", pady=(8, 0))

        ctk.CTkButton(bar, text="Rename", width=110, command=self._rename).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(
            bar, text="Make permanent", width=140, command=self._promote
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            bar,
            text="Remove / restore",
            width=150,
            fg_color="transparent",
            border_width=1,
            command=self._toggle_active,
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            bar,
            text="Delete permanently",
            width=160,
            fg_color="#8c2f26",
            hover_color="#a83a30",
            command=self._delete,
        ).pack(side="left")

        self.hint = ctk.CTkLabel(
            bar,
            text="Double-click a name to rename.",
            text_color="#888888",
        )
        self.hint.pack(side="right", padx=8)

    # -- data ------------------------------------------------------------
    def reload(self) -> None:
        include_inactive = bool(self.show_inactive.get())
        people = db.list_people(include_inactive=include_inactive)
        self._rows = people

        display = []
        for person in people:
            display.append(
                [
                    person["name"],
                    "Roster" if person["kind"] == db.KIND_ROSTER else "Walk-in",
                    "Active" if person["active"] else "Removed",
                    db.attendance_count(person["id"]),
                ]
            )

        widgets.fill_table(
            self.tree,
            display,
            tags_for=lambda row, i: ["muted"] if row[2] == "Removed" else [],
        )
        self.app.set_status(f"{len(people)} people listed")

    def _selected(self):
        selection = self.tree.selection()
        if not selection:
            return None
        index = self.tree.index(selection[0])
        if index >= len(self._rows):
            return None
        return self._rows[index]

    def _require_selection(self):
        person = self._selected()
        if person is None:
            messagebox.showinfo("Select someone", "Pick a person from the list first.", parent=self)
        return person

    # -- actions ---------------------------------------------------------
    def _add(self) -> None:
        name = self.name_entry.get().strip()
        if not name:
            return
        try:
            db.add_person(name, kind=db.KIND_ROSTER)
        except ValueError as exc:
            messagebox.showerror("Could not add", str(exc), parent=self)
            return
        self.name_entry.delete(0, "end")
        self.reload()
        self.app.refresh_other_tabs(source="roster")

    def _rename(self, _event=None) -> None:
        person = self._require_selection()
        if person is None:
            return
        dialog = ctk.CTkInputDialog(text=f"New name for {person['name']}:", title="Rename")
        new_name = (dialog.get_input() or "").strip()
        if not new_name or new_name == person["name"]:
            return
        try:
            db.rename_person(person["id"], new_name)
        except ValueError as exc:
            messagebox.showerror("Could not rename", str(exc), parent=self)
            return
        self.reload()
        self.app.refresh_other_tabs(source="roster")

    def _promote(self) -> None:
        person = self._require_selection()
        if person is None:
            return
        if person["kind"] == db.KIND_ROSTER:
            messagebox.showinfo(
                "Already permanent", f"{person['name']} is already on the roster.", parent=self
            )
            return
        db.promote_to_roster(person["id"])
        self.reload()
        self.app.refresh_other_tabs(source="roster")

    def _toggle_active(self) -> None:
        person = self._require_selection()
        if person is None:
            return
        make_active = not person["active"]
        db.set_person_active(person["id"], make_active)
        if not make_active:
            self.show_inactive.select()
        self.reload()
        self.app.refresh_other_tabs(source="roster")

    def _delete(self) -> None:
        person = self._require_selection()
        if person is None:
            return
        count = db.attendance_count(person["id"])
        message = f"Permanently delete {person['name']}?"
        if count:
            message += (
                f"\n\nThis also deletes their {count} attendance record"
                f"{'s' if count != 1 else ''}. This cannot be undone."
                "\n\nTo keep the history instead, use “Remove / restore”."
            )
        if not messagebox.askyesno("Delete permanently", message, parent=self):
            return
        db.delete_person(person["id"])
        self.reload()
        self.app.refresh_other_tabs(source="roster")
