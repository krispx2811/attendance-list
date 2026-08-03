"""Shared UI helpers.

The important piece here is :func:`make_table`. CustomTkinter has no table
widget, so grids use ``ttk.Treeview`` restyled to match the CustomTkinter
palette — without this the tables look like they belong to a different app.
"""

from __future__ import annotations

import tkinter as tk
from datetime import date, timedelta
from tkinter import ttk
from typing import Callable, Optional, Sequence

import customtkinter as ctk

# (dark, light) pairs mirroring CustomTkinter's own defaults.
_PALETTE = {
    "dark": {
        "bg": "#2b2b2b",
        "fg": "#dce4ee",
        "heading_bg": "#212121",
        "heading_fg": "#dce4ee",
        "selected": "#1f6aa5",
        "stripe": "#333333",
    },
    "light": {
        "bg": "#fbfbfb",
        "fg": "#1a1a1a",
        "heading_bg": "#e4e4e4",
        "heading_fg": "#1a1a1a",
        "selected": "#3b8ed0",
        "stripe": "#f0f0f0",
    },
}

STATUS_COLORS = {
    "Present": ("#2fa572", "#2cc985"),
    "Late": ("#c78a1e", "#e8a33d"),
    "Absent": ("#c0392b", "#e05c4b"),
}


def palette() -> dict:
    mode = ctk.get_appearance_mode().lower()
    return _PALETTE.get(mode, _PALETTE["dark"])


def apply_table_style() -> None:
    """Restyle ttk so Treeviews match the active CustomTkinter theme."""
    colors = palette()
    style = ttk.Style()
    try:
        style.theme_use("clam")  # the only built-in theme that honours colours
    except tk.TclError:
        pass

    style.configure(
        "Attendance.Treeview",
        background=colors["bg"],
        fieldbackground=colors["bg"],
        foreground=colors["fg"],
        borderwidth=0,
        rowheight=30,
        font=("Segoe UI", 12) if _has_font("Segoe UI") else ("", 12),
    )
    style.map(
        "Attendance.Treeview",
        background=[("selected", colors["selected"])],
        foreground=[("selected", "#ffffff")],
    )
    style.configure(
        "Attendance.Treeview.Heading",
        background=colors["heading_bg"],
        foreground=colors["heading_fg"],
        borderwidth=0,
        relief="flat",
        padding=(8, 8),
        font=("Segoe UI", 12, "bold") if _has_font("Segoe UI") else ("", 12, "bold"),
    )
    style.map(
        "Attendance.Treeview.Heading",
        background=[("active", colors["selected"])],
        foreground=[("active", "#ffffff")],
    )
    style.layout(
        "Attendance.Treeview",
        [("Attendance.Treeview.treearea", {"sticky": "nswe"})],  # drop the border
    )


def _has_font(name: str) -> bool:
    try:
        from tkinter import font as tkfont

        return name in tkfont.families()
    except Exception:
        return False


def make_table(
    parent,
    columns: Sequence[tuple[str, str, int]],
    on_double_click: Optional[Callable] = None,
    height: int = 12,
) -> tuple[ctk.CTkFrame, ttk.Treeview]:
    """Build a styled, scrollable table.

    ``columns`` is a sequence of ``(key, heading, width)``.
    """
    apply_table_style()
    colors = palette()

    container = ctk.CTkFrame(parent, corner_radius=8, fg_color=colors["bg"])
    container.grid_rowconfigure(0, weight=1)
    container.grid_columnconfigure(0, weight=1)

    keys = [c[0] for c in columns]
    tree = ttk.Treeview(
        container,
        columns=keys,
        show="headings",
        style="Attendance.Treeview",
        height=height,
        selectmode="browse",
    )
    for key, heading, width in columns:
        tree.heading(key, text=heading, anchor="w")
        tree.column(key, width=width, anchor="w", stretch=True)

    vsb = ctk.CTkScrollbar(container, command=tree.yview)
    tree.configure(yscrollcommand=vsb.set)

    tree.grid(row=0, column=0, sticky="nsew", padx=(6, 0), pady=6)
    vsb.grid(row=0, column=1, sticky="ns", padx=(2, 6), pady=6)

    tree.tag_configure("stripe", background=colors["stripe"])
    tree.tag_configure("absent", foreground=STATUS_COLORS["Absent"][1])
    tree.tag_configure("late", foreground=STATUS_COLORS["Late"][1])
    tree.tag_configure("muted", foreground="#888888")

    if on_double_click:
        tree.bind("<Double-1>", on_double_click)

    return container, tree


def fill_table(tree: ttk.Treeview, rows: Sequence[Sequence], tags_for=None) -> None:
    """Replace a table's contents, applying zebra striping."""
    tree.delete(*tree.get_children())
    for index, row in enumerate(rows):
        tags = ["stripe"] if index % 2 else []
        if tags_for:
            extra = tags_for(row, index)
            if extra:
                tags.extend(extra)
        tree.insert("", "end", values=tuple(row), tags=tuple(tags))


# --------------------------------------------------------------------------
# dates
# --------------------------------------------------------------------------

def parse_date(value: str) -> Optional[date]:
    """Parse a YYYY-MM-DD string, tolerating slashes and stray spaces."""
    text = (value or "").strip().replace("/", "-").replace(".", "-")
    if not text:
        return None
    try:
        parts = [int(p) for p in text.split("-")]
        if len(parts) != 3:
            return None
        return date(parts[0], parts[1], parts[2])
    except (ValueError, TypeError):
        return None


def format_long_date(value: date) -> str:
    return value.strftime("%A, %d %B %Y")


class DatePicker(ctk.CTkFrame):
    """Date field with previous/next-day arrows and a 'Today' shortcut.

    Deliberately dependency-free: a full calendar widget would mean pulling in
    tkcalendar for a field that is almost always left on today's date.
    """

    def __init__(self, master, on_change: Callable[[date], None], **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self._on_change = on_change
        self._value = date.today()

        self.prev_btn = ctk.CTkButton(self, text="‹", width=34, command=self._prev)
        self.entry = ctk.CTkEntry(self, width=130, justify="center")
        self.next_btn = ctk.CTkButton(self, text="›", width=34, command=self._next)
        self.today_btn = ctk.CTkButton(self, text="Today", width=64, command=self.reset_today)

        self.prev_btn.pack(side="left", padx=(0, 4))
        self.entry.pack(side="left")
        self.next_btn.pack(side="left", padx=(4, 6))
        self.today_btn.pack(side="left")

        self.entry.bind("<Return>", self._commit_entry)
        self.entry.bind("<FocusOut>", self._commit_entry)
        self._render()

    # -- public API ------------------------------------------------------
    @property
    def value(self) -> date:
        return self._value

    def set_value(self, value: date, notify: bool = True) -> None:
        self._value = value
        self._render()
        if notify:
            self._on_change(self._value)

    def reset_today(self) -> None:
        self.set_value(date.today())

    # -- internals -------------------------------------------------------
    def _render(self) -> None:
        self.entry.delete(0, "end")
        self.entry.insert(0, self._value.isoformat())

    def _prev(self) -> None:
        self.set_value(self._value - timedelta(days=1))

    def _next(self) -> None:
        self.set_value(self._value + timedelta(days=1))

    def _commit_entry(self, _event=None) -> None:
        parsed = parse_date(self.entry.get())
        if parsed is None:
            self._render()  # reject silently, restore the last good value
            return
        if parsed != self._value:
            self.set_value(parsed)
        else:
            self._render()


def month_bounds(today: Optional[date] = None) -> tuple[str, str]:
    today = today or date.today()
    first = today.replace(day=1)
    return first.isoformat(), today.isoformat()


def week_bounds(today: Optional[date] = None) -> tuple[str, str]:
    today = today or date.today()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat(), today.isoformat()
