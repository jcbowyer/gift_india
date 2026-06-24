"""Resolve GIFT_INDIA_PG* connection vars for dbt and shell targets.

``GIFT_INDIA_DB_URL`` is the canonical DSN for Python loaders; dbt reads
``GIFT_INDIA_PG*`` via ``gift_india_dbt/profiles.yml``. This module keeps them
in sync so a password embedded in the URL is available to ``make dbt``.
"""
from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_PG_KEYS = (
    "GIFT_INDIA_PGHOST",
    "GIFT_INDIA_PGPORT",
    "GIFT_INDIA_PGUSER",
    "GIFT_INDIA_PGPASSWORD",
    "GIFT_INDIA_PGDATABASE",
    "GIFT_INDIA_DB_URL",
)


def _parse_env_line(raw: str) -> tuple[str, str] | None:
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        return None
    key, _, val = line.partition("=")
    return key.strip(), val.strip().strip('"').strip("'")


def load_env_files() -> None:
    """Load repo ``.env`` then ``.env.local`` (``.env.local`` overrides).

    Values from ``.env`` always replace any stale shell exports so ``make dbt`` /
    ``make narrate-evidence`` match the file on disk.
    """
    for env_file in (_REPO_ROOT / ".env", _REPO_ROOT / ".env.local"):
        if not env_file.exists():
            continue
        for raw in env_file.read_text().splitlines():
            parsed = _parse_env_line(raw)
            if not parsed:
                continue
            key, val = parsed
            if (
                not val
                and key == "GIFT_INDIA_PGPASSWORD"
                and env_file.name == ".env"
            ):
                continue
            os.environ[key] = val


def _url_parts(url: str) -> dict[str, str]:
    parsed = urlparse(url.strip())
    parts: dict[str, str] = {}
    if parsed.hostname:
        parts["GIFT_INDIA_PGHOST"] = parsed.hostname
    if parsed.port:
        parts["GIFT_INDIA_PGPORT"] = str(parsed.port)
    if parsed.username:
        parts["GIFT_INDIA_PGUSER"] = unquote(parsed.username)
    if parsed.password is not None:
        parts["GIFT_INDIA_PGPASSWORD"] = unquote(parsed.password)
    dbname = (parsed.path or "").lstrip("/").split("?")[0]
    if dbname:
        parts["GIFT_INDIA_PGDATABASE"] = dbname
    return parts


def sync_from_url() -> dict[str, str]:
    """Apply GIFT_INDIA_PG* from ``GIFT_INDIA_DB_URL`` (URL wins over discrete vars)."""
    url = os.environ.get("GIFT_INDIA_DB_URL", "").strip()
    if not url:
        return {}

    applied: dict[str, str] = {}
    for key, value in _url_parts(url).items():
        os.environ[key] = value
        applied[key] = value
    return applied


def connection_params() -> dict[str, str]:
    sync_from_url()
    return {
        "host": os.environ.get("GIFT_INDIA_PGHOST", "localhost"),
        "port": os.environ.get("GIFT_INDIA_PGPORT", "5432"),
        "user": os.environ.get("GIFT_INDIA_PGUSER", "postgres"),
        "password": os.environ.get("GIFT_INDIA_PGPASSWORD", ""),
        "dbname": os.environ.get("GIFT_INDIA_PGDATABASE", "gift_india"),
    }


def check_connection() -> None:
    params = connection_params()
    if not params["password"]:
        host = params["host"]
        port = params["port"]
        sys.stderr.write(
            "ERROR: Postgres password required for dbt.\n"
            "Set your system Postgres password in `.env` or `.env.local`:\n"
            f"  GIFT_INDIA_DB_URL=postgresql://postgres:YOUR_PASSWORD@{host}:{port}/gift_india\n"
            "  # or\n"
            "  GIFT_INDIA_PGPASSWORD=YOUR_PASSWORD\n"
        )
        raise SystemExit(1)

    import psycopg

    conninfo = (
        f"host={params['host']} port={params['port']} "
        f"dbname={params['dbname']} user={params['user']} "
        f"password={params['password']} connect_timeout=5"
    )
    try:
        with psycopg.connect(conninfo):
            pass
    except psycopg.OperationalError as exc:
        sys.stderr.write(f"ERROR: Postgres connection failed: {exc}\n")
        raise SystemExit(1) from exc


def main() -> int:
    load_env_files()
    sync_from_url()
    if "--export" in sys.argv:
        for key in _PG_KEYS:
            if val := os.environ.get(key, ""):
                print(f"export {key}={shlex.quote(val)}")
        return 0
    if "--check" in sys.argv:
        check_connection()
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
