"""Main window: header, update banner, tabs and status bar."""

from __future__ import annotations

import webbrowser
from tkinter import messagebox

import customtkinter as ctk

from .. import db, paths, updater
from ..version import APP_NAME, __version__
from . import widgets
from .history_tab import HistoryTab
from .reports_tab import ReportsTab
from .roster_tab import RosterTab
from .today_tab import TodayTab


class AttendanceApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        ctk.set_appearance_mode("system")
        ctk.set_default_color_theme("blue")

        self.title(f"{APP_NAME}  v{__version__}")
        self.geometry("1180x760")
        self.minsize(980, 620)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        self._pending_release = None

        self._build_header()
        self._build_update_banner()
        # The status bar is built before the tabs: tab constructors call
        # set_status() while loading their initial data.
        self._build_status_bar()
        self._build_tabs()

        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(1500, self._start_update_check)

    # -- construction ----------------------------------------------------
    def _build_header(self) -> None:
        header = ctk.CTkFrame(self, corner_radius=0, height=64)
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text=APP_NAME, font=ctk.CTkFont(size=22, weight="bold")
        ).grid(row=0, column=0, padx=(20, 12), pady=14, sticky="w")

        ctk.CTkLabel(
            header,
            text=f"v{__version__}",
            text_color="#888888",
        ).grid(row=0, column=1, sticky="w")

        self.theme_menu = ctk.CTkOptionMenu(
            header,
            values=["System", "Light", "Dark"],
            width=110,
            command=self._on_theme_change,
        )
        self.theme_menu.set("System")
        self.theme_menu.grid(row=0, column=2, padx=(0, 20), pady=14, sticky="e")

    def _build_update_banner(self) -> None:
        self.banner = ctk.CTkFrame(self, corner_radius=0, fg_color=("#1f6aa5", "#14456b"))
        self.banner.grid_columnconfigure(0, weight=1)

        self.banner_label = ctk.CTkLabel(
            self.banner,
            text="",
            anchor="w",
            text_color="#ffffff",
            font=ctk.CTkFont(size=13, weight="bold"),
        )
        self.banner_label.grid(row=0, column=0, sticky="w", padx=20, pady=10)

        self.banner_action = ctk.CTkButton(
            self.banner, text="Update now", width=120, command=self._install_update
        )
        self.banner_action.grid(row=0, column=1, padx=(0, 8), pady=10)

        ctk.CTkButton(
            self.banner,
            text="What's new",
            width=110,
            fg_color="transparent",
            border_width=1,
            command=self._show_release_notes,
        ).grid(row=0, column=2, padx=(0, 8), pady=10)

        ctk.CTkButton(
            self.banner,
            text="Later",
            width=80,
            fg_color="transparent",
            border_width=1,
            command=self._hide_banner,
        ).grid(row=0, column=3, padx=(0, 20), pady=10)

    def _build_tabs(self) -> None:
        self.tabs = ctk.CTkTabview(self, anchor="nw")
        self.tabs.grid(row=2, column=0, sticky="nsew", padx=16, pady=(12, 8))

        for name in ("Today", "Employees", "History", "Reports"):
            self.tabs.add(name)
            self.tabs.tab(name).grid_columnconfigure(0, weight=1)
            self.tabs.tab(name).grid_rowconfigure(0, weight=1)

        self.today_tab = TodayTab(self.tabs.tab("Today"), self)
        self.today_tab.grid(row=0, column=0, sticky="nsew", padx=8, pady=8)

        self.roster_tab = RosterTab(self.tabs.tab("Employees"), self)
        self.roster_tab.grid(row=0, column=0, sticky="nsew", padx=8, pady=8)

        self.history_tab = HistoryTab(self.tabs.tab("History"), self)
        self.history_tab.grid(row=0, column=0, sticky="nsew", padx=8, pady=8)

        self.reports_tab = ReportsTab(self.tabs.tab("Reports"), self)
        self.reports_tab.grid(row=0, column=0, sticky="nsew", padx=8, pady=8)

        self.tabs.configure(command=self._on_tab_change)

    def _build_status_bar(self) -> None:
        bar = ctk.CTkFrame(self, corner_radius=0, height=28)
        bar.grid(row=3, column=0, sticky="ew")
        bar.grid_columnconfigure(0, weight=1)

        self.status_label = ctk.CTkLabel(
            bar, text="Ready", anchor="w", text_color="#888888"
        )
        self.status_label.grid(row=0, column=0, sticky="w", padx=20, pady=4)

        ctk.CTkLabel(
            bar, text=str(paths.data_dir()), anchor="e", text_color="#666666"
        ).grid(row=0, column=1, sticky="e", padx=20, pady=4)

    # -- cross-tab plumbing ----------------------------------------------
    def set_status(self, message: str) -> None:
        self.status_label.configure(text=message)

    def refresh_other_tabs(self, source: str) -> None:
        """Propagate a change so every tab reflects it without a restart."""
        if source != "today":
            self.today_tab.reload()
        if source != "roster":
            self.roster_tab.reload()
        if source != "history":
            self.history_tab.reload()
        if source != "reports":
            self.reports_tab.reload()

    def _on_tab_change(self) -> None:
        # Reload on arrival so a tab never shows data edited elsewhere.
        current = self.tabs.get()
        if current == "Today":
            self.today_tab.reload()
        elif current == "Employees":
            self.roster_tab.reload()
        elif current == "History":
            self.history_tab.reload()
        elif current == "Reports":
            self.reports_tab.reload()

    def _on_theme_change(self, value: str) -> None:
        ctk.set_appearance_mode(value.lower())
        widgets.apply_table_style()
        self.after(50, self._restyle_tables)

    def _restyle_tables(self) -> None:
        """Re-apply row tag colours after an appearance-mode switch."""
        widgets.apply_table_style()
        for tab in (self.roster_tab, self.history_tab, self.reports_tab):
            try:
                tab.reload()
            except Exception:
                pass

    # -- updates ---------------------------------------------------------
    def _start_update_check(self) -> None:
        updater.check_in_background(
            lambda release: self.after(0, self._on_update_found, release)
        )

    def check_for_updates_now(self) -> None:
        self.set_status("Checking for updates…")

        def done(release):
            self.after(0, self._on_manual_check_result, release)

        import threading

        threading.Thread(
            target=lambda: done(updater.fetch_latest()), daemon=True
        ).start()

    def _on_manual_check_result(self, release) -> None:
        if release is None:
            self.set_status("Could not reach GitHub — check your connection.")
            messagebox.showinfo(
                "Update check",
                "Could not reach GitHub to check for updates.\n\n"
                "Check your internet connection and try again.",
                parent=self,
            )
            return
        if not release.is_newer:
            self.set_status(f"Up to date (v{__version__})")
            messagebox.showinfo(
                "Up to date",
                f"You are running the latest version (v{__version__}).",
                parent=self,
            )
            return
        self._on_update_found(release)

    def _on_update_found(self, release) -> None:
        self._pending_release = release
        self.banner_label.configure(
            text=f"Version {release.version} is available — you have {__version__}."
        )
        if not updater.can_self_update():
            self.banner_action.configure(text="Open download page")
        self.banner.grid(row=1, column=0, sticky="ew")
        self.set_status(f"Update available: v{release.version}")

    def _hide_banner(self) -> None:
        self.banner.grid_forget()

    def _show_release_notes(self) -> None:
        if not self._pending_release:
            return
        notes = self._pending_release.notes or "No release notes were provided."
        messagebox.showinfo(
            f"What's new in v{self._pending_release.version}", notes, parent=self
        )

    def _install_update(self) -> None:
        release = self._pending_release
        if not release:
            return

        if not updater.can_self_update():
            # Running from source or not on Windows: send them to the page.
            webbrowser.open(updater.RELEASES_PAGE)
            return

        if not messagebox.askyesno(
            "Update now",
            f"Download and install version {release.version}?\n\n"
            "The app will close and reopen automatically.\n"
            "Your attendance data is not affected.",
            parent=self,
        ):
            return

        UpdateProgressWindow(self, release)

    def _on_close(self) -> None:
        try:
            db.close()
        finally:
            self.destroy()


class UpdateProgressWindow(ctk.CTkToplevel):
    """Downloads the new build, then hands off to the swap script."""

    def __init__(self, master: AttendanceApp, release):
        super().__init__(master)
        self.app = master
        self.release = release

        self.title("Updating")
        self.geometry("420x170")
        self.resizable(False, False)
        self.protocol("WM_DELETE_WINDOW", lambda: None)  # no cancel mid-swap

        self.label = ctk.CTkLabel(
            self, text=f"Downloading version {release.version}…", font=ctk.CTkFont(size=14)
        )
        self.label.pack(pady=(28, 12))

        self.bar = ctk.CTkProgressBar(self, width=340)
        self.bar.set(0)
        self.bar.pack(pady=(0, 8))

        self.detail = ctk.CTkLabel(self, text="", text_color="#888888")
        self.detail.pack()

        self.after(120, self._focus)
        self.after(300, self._start)

    def _focus(self) -> None:
        self.lift()
        self.focus_force()
        try:
            self.grab_set()
        except Exception:
            pass

    def _start(self) -> None:
        import threading

        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        try:
            new_exe = updater.download(self.release, progress=self._progress)
        except Exception as exc:
            self.after(0, self._failed, str(exc))
            return
        self.after(0, self._apply, new_exe)

    def _progress(self, written: int, total: int) -> None:
        if total:
            fraction = written / total
            text = f"{written / 1_048_576:.1f} MB of {total / 1_048_576:.1f} MB"
        else:
            fraction = 0
            text = f"{written / 1_048_576:.1f} MB"
        self.after(0, self._render_progress, fraction, text)

    def _render_progress(self, fraction: float, text: str) -> None:
        self.bar.set(fraction)
        self.detail.configure(text=text)

    def _failed(self, message: str) -> None:
        try:
            self.grab_release()
        except Exception:
            pass
        self.destroy()
        messagebox.showerror(
            "Update failed",
            f"{message}\n\nThe current version is unchanged and still works.",
            parent=self.app,
        )

    def _apply(self, new_exe) -> None:
        self.label.configure(text="Installing — the app will reopen…")
        self.detail.configure(text="")
        self.bar.set(1)
        self.update_idletasks()
        try:
            updater.apply_update(new_exe)
        except Exception as exc:
            self._failed(str(exc))
            return
        db.close()
        self.app.destroy()
