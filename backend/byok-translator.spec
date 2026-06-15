# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for a single-file binary that bundles the API and the UI.

Build:  uv run pyinstaller byok-translator.spec --clean --noconfirm
Output: dist/byok-translator

Datas are unpacked under sys._MEIPASS at runtime; app/resources.py resolves
config/ and frontend/ there. uvicorn's loop/protocol backends are imported
dynamically, so they are collected explicitly as hidden imports.
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

# keyring discovers backends via entry points, which PyInstaller misses without
# help. collect_all pulls its metadata so the libsecret backend loads in the
# frozen binary too (it still degrades gracefully if no Secret Service exists).
keyring_datas, keyring_binaries, keyring_hidden = collect_all("keyring")

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("anyio")
    + collect_submodules("secretstorage")
    + collect_submodules("jeepney")
    + keyring_hidden
    + ["app"]
)

datas = [
    ("config/defaults.yaml", "config"),
    ("../frontend", "frontend"),
] + keyring_datas

a = Analysis(
    ["app/__main__.py"],
    pathex=["."],
    binaries=keyring_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="byok-translator",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
