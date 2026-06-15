"""Database connectivity for gift_india India.

One code path serves two targets:

* **Local Postgres** (docker compose) for fast iteration — set ``GIFT_INDIA_DB_URL``.
* **Databricks Lakebase** (managed serverless Postgres) — resolve the endpoint
  host and a short-lived OAuth credential via the Databricks CLI, then connect
  over SSL.

If no database is configured, callers fall back to the synthetic CSV dataset in
``src.data`` so the demo always runs with zero external dependencies.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pandas as pd
import psycopg

DEFAULT_SCHEMA = os.getenv("GIFT_INDIA_DB_SCHEMA", "public")
LOCAL_DEFAULT_DSN = "postgresql://gift_india:gift_india@localhost:5432/gift_india"

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"
_dotenv_loaded = False


def _load_dotenv() -> None:
    """Best-effort load of a local ``.env`` (no extra dependency)."""
    global _dotenv_loaded
    if _dotenv_loaded:
        return
    _dotenv_loaded = True
    if not _ENV_FILE.exists():
        return
    for raw in _ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def database_url() -> str | None:
    """Resolve a Postgres DSN from the environment, or ``None`` if unset.

    Precedence: ``GIFT_INDIA_DB_URL`` → standard ``PG*`` variables (as injected by a
    Databricks App with a Lakebase resource) → ``None``.
    """
    _load_dotenv()
    if url := os.getenv("GIFT_INDIA_DB_URL"):
        return url

    host = os.getenv("PGHOST")
    if host:
        user = os.getenv("PGUSER", "")
        pwd = os.getenv("PGPASSWORD", "")
        database = os.getenv("PGDATABASE", "databricks_postgres")
        port = os.getenv("PGPORT", "5432")
        sslmode = os.getenv("PGSSLMODE", "require")
        auth = f"{user}:{pwd}@" if user else ""
        return f"postgresql://{auth}{host}:{port}/{database}?sslmode={sslmode}"
    return None


def is_configured() -> bool:
    return database_url() is not None


def connect(dsn: str | None = None) -> psycopg.Connection:
    dsn = dsn or database_url()
    if not dsn:
        raise RuntimeError(
            "No database configured. Set GIFT_INDIA_DB_URL (see .env.example) or "
            "start local Postgres with `docker compose up -d`."
        )
    return psycopg.connect(dsn)


def fetch_df(conn: psycopg.Connection, sql: str) -> pd.DataFrame:
    """Run a query and return a DataFrame (avoids a SQLAlchemy dependency)."""
    with conn.cursor() as cur:
        cur.execute(sql)
        columns = [c.name for c in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=columns)


# --------------------------------------------------------------- Lakebase
def _databricks_json(args: list[str], profile: str | None) -> dict:
    cmd = ["databricks", *args, "-o", "json"]
    if profile:
        cmd += ["--profile", profile]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def current_user(profile: str | None = None) -> str:
    """Return the authenticated Databricks username (used as the Postgres role)."""
    return _databricks_json(["current-user", "me"], profile)["userName"]


def lakebase_credentials(endpoint: str, profile: str | None = None) -> dict[str, str]:
    """Resolve ``{host, token}`` for a Lakebase endpoint via the Databricks CLI.

    ``endpoint`` is the endpoint resource path, e.g.
    ``projects/<id>/branches/production/endpoints/<endpoint_id>``. The token is a
    short-lived OAuth credential (expires after ~1 hour).
    """
    ep = _databricks_json(["postgres", "get-endpoint", endpoint], profile)
    host = ep["status"]["hosts"]["host"]
    cred = _databricks_json(
        ["postgres", "generate-database-credential", endpoint], profile
    )
    return {"host": host, "token": cred["token"]}
