# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build definition.

CustomTkinter ships theme JSON and font files that PyInstaller's static
analysis cannot see. Without ``collect_all`` the packaged app raises
FileNotFoundError on its very first window — this is the single most common
way a CustomTkinter build fails.
"""

from PyInstaller.utils.hooks import collect_all

datas = [("assets/icon.ico", "assets")]
binaries = []
hiddenimports = []

for package in ("customtkinter",):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Nothing here is imported; excluding them keeps the download small.
        "matplotlib",
        "numpy",
        "pandas",
        "scipy",
        "PIL",
        "pytest",
        "setuptools",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="AttendanceList",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,          # windowed app: no console flashes on launch
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="assets/icon.ico",
)
