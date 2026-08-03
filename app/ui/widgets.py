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


# --------------------------------------------------------------------------
# status colours
# --------------------------------------------------------------------------

#: (normal, hover) per status — used to colour the segmented buttons so a
#: day can be read at a glance instead of parsed word by word.
STATUS_FILL = {
    "Present": ("#2fa572", "#279260"),
    "Late": ("#c68a1e", "#b07a15"),
    "Absent": ("#c0392b", "#a83024"),
}

MUTED = "#8a8a8a"

#: (light, dark) surface colour for cards and rows, one step off the page
#: background so panels read as raised rather than blending into it.
CARD_BG = ("#f4f5f7", "#2c2f33")

_AVATAR_COLORS = [
    "#3b7dd8", "#2fa572", "#c68a1e", "#c0392b", "#8e44ad",
    "#16a085", "#d35400", "#2c7a7b", "#b03a6e", "#5b6abf",
]


def avatar_color(name: str) -> str:
    """Stable colour per person, so faces stay recognisable between sessions."""
    return _AVATAR_COLORS[sum(ord(c) for c in name) % len(_AVATAR_COLORS)]


def initials(name: str) -> str:
    parts = [p for p in name.strip().split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


class Avatar(ctk.CTkFrame):
    """Coloured circle showing a person's initials."""

    def __init__(self, master, name: str, size: int = 40):
        super().__init__(
            master,
            width=size,
            height=size,
            corner_radius=size // 2,
            fg_color=avatar_color(name),
        )
        self.grid_propagate(False)
        self.pack_propagate(False)
        ctk.CTkLabel(
            self,
            text=initials(name),
            font=ctk.CTkFont(size=int(size * 0.34), weight="bold"),
            text_color="#ffffff",
        ).place(relx=0.5, rely=0.5, anchor="center")


class StatCard(ctk.CTkFrame):
    """Big number with a caption — the day's counts at a glance."""

    def __init__(self, master, caption: str, accent: str, **kwargs):
        kwargs.setdefault("fg_color", CARD_BG)
        super().__init__(master, corner_radius=10, height=1, **kwargs)
        self.value_label = ctk.CTkLabel(
            self, text="0", font=ctk.CTkFont(size=28, weight="bold"), text_color=accent
        )
        self.value_label.pack(padx=22, pady=(14, 0))
        ctk.CTkLabel(
            self, text=caption.upper(), font=ctk.CTkFont(size=10, weight="bold"),
            text_color=MUTED,
        ).pack(padx=22, pady=(2, 14))

    def set_value(self, value) -> None:
        self.value_label.configure(text=str(value))


class BulkAddDialog(ctk.CTkToplevel):
    """Paste or type a list of names, one per line, and add them all.

    Typing employees in one at a time is the slowest possible way to set the
    app up, and setup is the moment someone decides whether to keep using it.
    """

    def __init__(self, master, on_done):
        super().__init__(master)
        self.on_done = on_done
        self.title("Add employees")
        self.geometry("520x460")
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        ctk.CTkLabel(
            self,
            text="Add your employees",
            font=ctk.CTkFont(size=20, weight="bold"),
            anchor="w",
        ).grid(row=0, column=0, sticky="ew", padx=24, pady=(22, 2))

        ctk.CTkLabel(
            self,
            text="One name per line. You can paste a list straight from a\n"
                 "spreadsheet or document.",
            justify="left",
            anchor="w",
            text_color=MUTED,
        ).grid(row=1, column=0, sticky="ew", padx=24, pady=(0, 12))

        self.textbox = ctk.CTkTextbox(self, font=ctk.CTkFont(size=14))
        self.textbox.grid(row=2, column=0, sticky="nsew", padx=24)
        self.textbox.insert("1.0", "")

        self.hint = ctk.CTkLabel(self, text="", anchor="w", text_color=MUTED)
        self.hint.grid(row=3, column=0, sticky="ew", padx=24, pady=(8, 0))

        buttons = ctk.CTkFrame(self, fg_color="transparent")
        buttons.grid(row=4, column=0, sticky="ew", padx=24, pady=18)
        buttons.grid_columnconfigure(0, weight=1)

        ctk.CTkButton(
            buttons, text="Cancel", width=100, fg_color="transparent",
            border_width=1, command=self.destroy,
        ).grid(row=0, column=1, padx=(0, 8))
        ctk.CTkButton(buttons, text="Add them", width=130, command=self._submit).grid(
            row=0, column=2
        )

        self.after(120, self._focus)

    def _focus(self) -> None:
        self.lift()
        self.focus_force()
        self.textbox.focus_set()
        try:
            self.grab_set()
        except Exception:
            pass

    def _submit(self) -> None:
        raw = self.textbox.get("1.0", "end")
        names, seen = [], set()
        for line in raw.splitlines():
            name = line.strip(" \t,;")
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            names.append(name)

        if not names:
            self.hint.configure(text="Type at least one name first.")
            return

        self.destroy()
        self.on_done(names)


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
