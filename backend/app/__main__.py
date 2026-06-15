"""Console / frozen-binary entrypoint.

Runs the ASGI app via uvicorn using the app *object* (not an import string)
so it works identically from source (``python -m app``) and from a frozen
single-file binary, where import-string reloading is unavailable.
"""

from __future__ import annotations

import argparse
import os

import uvicorn

from app import __version__
from app.main import app


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="byok-translator",
        description="BYOK OpenRouter translation server (API + bundled UI).",
    )
    parser.add_argument(
        "--host", default=os.environ.get("TRANSLATOR_HOST", "127.0.0.1")
    )
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("TRANSLATOR_PORT", "8000"))
    )
    parser.add_argument("--version", action="version", version=__version__)
    args = parser.parse_args()

    print(f"byok-translator {__version__}  →  http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
