"""Self-update against GitHub Releases.

Flow: check the latest release tag, and if it is newer than the running build,
download the attached ``.exe`` and hand off to a small batch script that swaps
the file once this process exits — Windows will not let a running executable
overwrite itself, so the swap has to happen from outside.

Every failure path is non-fatal. Being offline, rate-limited, or behind a
proxy must never stop the app from opening.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import requests

from . import paths
from .version import (
    GITHUB_OWNER,
    GITHUB_REPO,
    RELEASE_ASSET_NAME,
    __version__,
    version_tuple,
)

API_LATEST = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
RELEASES_PAGE = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases"

CHECK_TIMEOUT = 6  # seconds
DOWNLOAD_TIMEOUT = 120


@dataclass
class ReleaseInfo:
    version: str
    tag: str
    notes: str
    download_url: str
    size: int

    @property
    def is_newer(self) -> bool:
        return version_tuple(self.version) > version_tuple(__version__)


def can_self_update() -> bool:
    """Self-replacement only makes sense for a frozen Windows executable."""
    return paths.is_frozen() and sys.platform == "win32"


# --------------------------------------------------------------------------
# checking
# --------------------------------------------------------------------------

def fetch_latest() -> Optional[ReleaseInfo]:
    """Return the latest release, or ``None`` if unavailable for any reason."""
    try:
        response = requests.get(
            API_LATEST,
            timeout=CHECK_TIMEOUT,
            headers={"Accept": "application/vnd.github+json"},
        )
        if response.status_code != 200:
            return None
        payload = response.json()
    except Exception:
        return None

    tag = str(payload.get("tag_name") or "").strip()
    if not tag:
        return None

    download_url = ""
    size = 0
    for asset in payload.get("assets") or []:
        if asset.get("name") == RELEASE_ASSET_NAME:
            download_url = asset.get("browser_download_url") or ""
            size = int(asset.get("size") or 0)
            break

    return ReleaseInfo(
        version=tag.lstrip("vV"),
        tag=tag,
        notes=(payload.get("body") or "").strip(),
        download_url=download_url,
        size=size,
    )


def check_in_background(callback: Callable[[Optional[ReleaseInfo]], None]) -> None:
    """Check for updates off the UI thread.

    ``callback`` is invoked with the release only when a *newer* one exists;
    the caller is responsible for marshalling back onto the UI thread.
    """

    def worker() -> None:
        try:
            release = fetch_latest()
        except Exception:
            release = None
        if release and release.is_newer and release.download_url:
            callback(release)

    threading.Thread(target=worker, daemon=True, name="update-check").start()


# --------------------------------------------------------------------------
# downloading / installing
# --------------------------------------------------------------------------

def download(
    release: ReleaseInfo, progress: Optional[Callable[[int, int], None]] = None
) -> Path:
    """Download the new executable to a temp file and return its path."""
    target = Path(tempfile.gettempdir()) / f"AttendanceList-{release.version}.exe"

    with requests.get(release.download_url, stream=True, timeout=DOWNLOAD_TIMEOUT) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length") or release.size or 0)
        written = 0
        with target.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                fh.write(chunk)
                written += len(chunk)
                if progress:
                    progress(written, total)

    # A truncated download would otherwise replace a working app with a stub.
    if release.size and target.stat().st_size != release.size:
        target.unlink(missing_ok=True)
        raise IOError("Downloaded file was incomplete. Update cancelled.")
    if target.stat().st_size < 1_000_000:
        target.unlink(missing_ok=True)
        raise IOError("Downloaded file looks invalid. Update cancelled.")

    return target


_SWAP_SCRIPT = r"""@echo off
setlocal
set "NEWEXE={new_exe}"
set "CURRENT={current_exe}"
set "PID={pid}"

rem Wait for the running app to close (up to ~30 seconds).
rem ping is used rather than timeout: timeout needs a console this script has not got.
for /l %%i in (1,1,30) do (
    tasklist /fi "PID eq %PID%" 2>nul | find "%PID%" >nul
    if errorlevel 1 goto :swap
    ping -n 2 127.0.0.1 >nul
)

:swap
rem Keep the old build until the move succeeds, so a failure is recoverable.
move /y "%CURRENT%" "%CURRENT%.old" >nul 2>&1
move /y "%NEWEXE%" "%CURRENT%" >nul 2>&1
if errorlevel 1 (
    rem Swap failed - restore the previous build and leave it running.
    move /y "%CURRENT%.old" "%CURRENT%" >nul 2>&1
) else (
    del "%CURRENT%.old" >nul 2>&1
)

start "" "%CURRENT%"
del "%~f0" >nul 2>&1
"""


def apply_update(new_exe: Path) -> None:
    """Launch the swap script and exit so the file can be replaced.

    Returns only if the handoff itself failed; on success the process ends.
    """
    if not can_self_update():
        raise RuntimeError("Self-update is only supported for the Windows executable.")

    current = Path(sys.executable).resolve()
    script = Path(tempfile.gettempdir()) / "attendance_update.bat"
    script.write_text(
        _SWAP_SCRIPT.format(new_exe=new_exe, current_exe=current, pid=os.getpid()),
        encoding="utf-8",
    )

    # CREATE_NO_WINDOW keeps the swap silent. DETACHED_PROCESS is deliberately
    # not combined with it — Windows rejects that pairing.
    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]

    subprocess.Popen(
        ["cmd", "/c", str(script)],
        close_fds=True,
        creationflags=creation_flags,
    )
