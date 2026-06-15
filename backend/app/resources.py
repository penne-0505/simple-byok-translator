"""Resource path resolution that works both from source and from a PyInstaller
single-file binary.

When frozen, PyInstaller unpacks bundled data under ``sys._MEIPASS``; from
source the same files live under ``backend/`` (config) and the repo root
(frontend). Centralizing this here keeps the rest of the code from sprinkling
``sys.frozen`` checks around.
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/
_REPO_DIR = _BACKEND_DIR.parent  # repo root


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def base_dir() -> Path:
    """Root for bundled resources (config, frontend)."""
    if is_frozen():
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return _BACKEND_DIR


def config_dir_path(relative: str) -> Path:
    """Resolve a config-relative path. ``config/defaults.yaml`` lives under
    ``backend/`` in source and under ``_MEIPASS/`` when frozen."""
    p = Path(relative)
    return p if p.is_absolute() else base_dir() / p


def frontend_dir() -> Path:
    """Directory of the static frontend the server can self-host.

    Frozen: ``_MEIPASS/frontend``. Source: ``<repo>/frontend``.
    """
    if is_frozen():
        return base_dir() / "frontend"
    return _REPO_DIR / "frontend"
