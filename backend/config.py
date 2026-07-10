"""
backend/config.py
------------------
Single source of truth for environment variable loading.

Loads .env using an ABSOLUTE path anchored to this file's location,
so it works correctly regardless of which directory you run Python from.

Every other module that needs env vars should import from here:

    from backend.config import settings   (when run from project root)
    from config import settings           (when run inside backend/)

Usage:
    import os
    from backend.config import _  # just importing this module loads the env
    value = os.getenv("MY_KEY")
"""

from pathlib import Path
from dotenv import load_dotenv

# This file lives at <project_root>/backend/config.py
# So .env lives at <project_root>/backend/.env
_ENV_PATH = Path(__file__).resolve().parent / ".env"

_loaded = load_dotenv(dotenv_path=_ENV_PATH, override=False)

if not _loaded:
    import warnings
    warnings.warn(
        f"[config] .env file not found at {_ENV_PATH}. "
        "Make sure you have copied .env.example to .env and filled in your keys.",
        stacklevel=2,
    )
