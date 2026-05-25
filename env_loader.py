"""Load key/value pairs from a local .env file into os.environ."""

from __future__ import annotations

import os
from pathlib import Path


def load_local_env(env_path: Path | None = None) -> None:
    path = env_path or Path(__file__).resolve().parent / ".env"
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
