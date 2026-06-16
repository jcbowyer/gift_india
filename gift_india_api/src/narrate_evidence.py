"""Narrate capability evidence via Agent Bricks and land JSON + Markdown in gold.*

Layer 1 (deterministic): ``make dbt`` builds ``gold.capability_scored``.
Layer 2 (LLM narration): this module calls the Agent Bricks serving endpoint
(``open_navigator_evidence_agent``) through Databricks ``ai_query`` on a SQL
warehouse, then upserts results into:

* ``gold.capability_evidence_json`` — structured assessment for the citation panel
* ``gold.capability_evidence_md`` — compact Markdown evidence card

Planner overrides in ``app.capability_overrides`` supersede the LLM default.

Usage::

    # After `make dbt` (or `make load-virtue` + scored rebuild):
    python -m src.narrate_evidence --profile gift-india-mb --limit 50
    python -m src.narrate_evidence --target lakebase \\
        --endpoint projects/gift-india/branches/production/endpoints/primary \\
        --profile gift-india-mb

Environment:
    EVIDENCE_AGENT_ENDPOINT — override serving endpoint (default open_navigator_evidence_agent)
    DATABRICKS_WAREHOUSE_ID — SQL warehouse for ai_query (default 234ccf680e359443)
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

from . import db
from .evidence_prompts import (
    DEFAULT_ENDPOINT,
    JSON_RESPONSE_FORMAT,
    json_prompt,
    markdown_prompt,
)

DEFAULT_OWNER = "admins"
DEFAULT_WAREHOUSE = os.getenv("DATABRICKS_WAREHOUSE_ID", "234ccf680e359443")
STAGING_SCHEMA = os.getenv("EVIDENCE_STAGING_SCHEMA", "gift_india_gold")
STAGING_TABLE = f"{STAGING_SCHEMA}.capability_scored_staging"

DDL = """
CREATE SCHEMA IF NOT EXISTS gold;

CREATE TABLE IF NOT EXISTS gold.capability_evidence_json (
    facility_id               text NOT NULL,
    facility_name             text,
    capability                text NOT NULL,
    evidence_strength_score   numeric,
    evidence_tier             text,
    assessment_json           jsonb NOT NULL,
    model_endpoint            text,
    narrated_at               timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (facility_id, capability)
);

CREATE TABLE IF NOT EXISTS gold.capability_evidence_md (
    facility_id               text NOT NULL,
    facility_name             text,
    capability                text NOT NULL,
    evidence_strength_score   numeric,
    evidence_tier             text,
    assessment_md             text NOT NULL,
    model_endpoint            text,
    narrated_at               timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (facility_id, capability)
);

CREATE INDEX IF NOT EXISTS capability_evidence_json_tier_idx
    ON gold.capability_evidence_json (capability, evidence_tier);
CREATE INDEX IF NOT EXISTS capability_evidence_md_tier_idx
    ON gold.capability_evidence_md (capability, evidence_tier);
"""

SCORED_COLUMNS = """
    facility_id, facility_name, capability, capability_label,
    evidence_strength_score, evidence_tier, evidence_context,
    supporting_count, contradicting_count, best_source, trust_signal
"""


def _sql_str(val: Any) -> str:
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def _lakebase_dsn(args: argparse.Namespace) -> str:
    creds = db.lakebase_credentials(args.endpoint, args.profile)
    user = args.user or args.owner
    return (
        f"postgresql://{quote(user)}:{quote(creds['token'])}@"
        f"{creds['host']}:5432/{args.database}?sslmode=require"
    )


def fetch_scored(conn, *, limit: int | None, capability: str | None) -> list[dict[str, Any]]:
    clauses = ["(claimed OR trust_signal <> 'no_claim')"]
    params: list[Any] = []
    if capability:
        clauses.append("capability = %s")
        params.append(capability)
    limit_sql = ""
    if limit:
        limit_sql = "LIMIT %s"
        params.append(limit)
    sql = f"""
        SELECT {SCORED_COLUMNS}
        FROM gold.capability_scored
        WHERE {' AND '.join(clauses)}
        ORDER BY evidence_strength_score DESC, facility_name, capability
        {limit_sql}
    """
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _wait_statement(w: WorkspaceClient, statement_id: str, *, poll_s: float = 2.0) -> None:
    while True:
        resp = w.statement_execution.get_statement(statement_id)
        state = resp.status.state
        if state == StatementState.SUCCEEDED:
            return
        if state in (StatementState.FAILED, StatementState.CANCELED, StatementState.CLOSED):
            err = resp.status.error or resp.status
            raise RuntimeError(f"Databricks SQL failed ({state}): {err}")
        time.sleep(poll_s)


def _exec_sql(w: WorkspaceClient, warehouse_id: str, statement: str) -> None:
    resp = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=statement,
        wait_timeout="0s",
    )
    _wait_statement(w, resp.statement_id)


def stage_scored_on_databricks(
    w: WorkspaceClient,
    warehouse_id: str,
    rows: list[dict[str, Any]],
    *,
    batch_size: int = 200,
) -> None:
    _exec_sql(w, warehouse_id, f"CREATE SCHEMA IF NOT EXISTS {STAGING_SCHEMA}")
    _exec_sql(
        w,
        warehouse_id,
        f"""
        CREATE OR REPLACE TABLE {STAGING_TABLE} (
            facility_id STRING,
            facility_name STRING,
            capability STRING,
            capability_label STRING,
            evidence_strength_score DOUBLE,
            evidence_tier STRING,
            evidence_context STRING,
            supporting_count INT,
            contradicting_count INT,
            best_source STRING,
            trust_signal STRING
        ) USING DELTA
        """,
    )
    if not rows:
        return
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        values = ",\n".join(
            "("
            + ", ".join(
                [
                    _sql_str(r["facility_id"]),
                    _sql_str(r["facility_name"]),
                    _sql_str(r["capability"]),
                    _sql_str(r["capability_label"]),
                    str(float(r["evidence_strength_score"])),
                    _sql_str(r["evidence_tier"]),
                    _sql_str(r["evidence_context"]),
                    str(int(r["supporting_count"])),
                    str(int(r["contradicting_count"])),
                    _sql_str(r["best_source"]),
                    _sql_str(r["trust_signal"]),
                ]
            )
            + ")"
            for r in batch
        )
        _exec_sql(w, warehouse_id, f"INSERT INTO {STAGING_TABLE} VALUES {values}")


def build_narration_sql(endpoint: str) -> tuple[str, str]:
    """Return (json_table_sql, md_table_sql) using ai_query on staged rows."""
    json_prefix = (
        "You are a verification assistant for a hospital capability registry. "
        "A care planner is checking whether a facility truly offers a given clinical "
        "capability. Use the numbers EXACTLY as provided — do not recompute or invent "
        "any value or source.\\n\\n"
    )
    json_task = (
        "\\n\\nTASK\\n"
        "1. Map evidence_tier to verdict: Strong→Confirmed, Moderate→Likely, "
        "Weak→Needs review, Insufficient→Unsupported. Never exceed \\\"Needs review\\\" "
        "when contradicting > 0 or trust_signal = weak_suspicious.\\n"
        "2. Specialty corroboration: state whether the on-record specialties plausibly "
        "support this capability.\\n"
        "3. Write a 1–2 sentence plain-language rationale a non-clinical planner can act on.\\n"
        "4. List citations drawn ONLY from the evidence above.\\n"
        "5. Recommend human review and give a reason; force true when "
        "trust_signal = weak_suspicious or contradicting > 0.\\n\\n"
        "Return ONLY JSON matching the schema. No prose, no markdown."
    )
    md_prefix = (
        "You are a verification assistant for a hospital capability registry. "
        "Use the numbers EXACTLY as provided — never invent sources or values.\\n\\n"
    )
    md_task = (
        "\\n\\nTASK\\n"
        "Produce a compact Markdown evidence card the planner sees when expanding "
        "this facility. Use exactly this structure:\\n\\n"
        "### {facility_name} — {capability_label}\\n"
        "**Verdict:** <Confirmed | Likely | Needs review | Unsupported>  ·  "
        "**Evidence:** {evidence_tier} ({evidence_strength_score})\\n\\n"
        "<one-sentence plain-language verdict>\\n\\n"
        "**Why:**\\n- <supporting point>\\n- <specialty corroboration>\\n- <gap if any>\\n\\n"
        "**Citations:**\\n- {best_source} — <what it supports>\\n"
        "- {supporting_count} supporting / {contradicting_count} contradicting items\\n"
        "- Specialties on record: <only the relevant ones>\\n\\n"
        "**Review:** <✅ Looks solid | ⚠️ Needs human review> — <reason>\\n\\n"
        "Rules: evidence only, no invented sources/numbers, under 120 words, "
        "and never rate above \\\"Needs review\\\" when contradicting > 0 or "
        "trust_signal = weak_suspicious."
    )
    rf = JSON_RESPONSE_FORMAT.replace("'", "\\'")

    json_sql = f"""
CREATE OR REPLACE TABLE {STAGING_SCHEMA}.capability_evidence_json AS
SELECT
  facility_id,
  facility_name,
  capability,
  evidence_strength_score,
  evidence_tier,
  ai_query(
    endpoint => '{endpoint}',
    request => CONCAT(
      '{json_prefix}',
      evidence_context,
      '{json_task}'
    ),
    responseFormat => '{rf}'
  ) AS assessment_json
FROM {STAGING_TABLE}
"""

    md_sql = f"""
CREATE OR REPLACE TABLE {STAGING_SCHEMA}.capability_evidence_md AS
SELECT
  facility_id,
  facility_name,
  capability,
  evidence_strength_score,
  evidence_tier,
  ai_query(
    endpoint => '{endpoint}',
    request => CONCAT(
      '{md_prefix}',
      evidence_context,
      '{md_task}'
    )
  ) AS assessment_md
FROM {STAGING_TABLE}
"""
    return json_sql, md_sql


def _fetch_table(w: WorkspaceClient, warehouse_id: str, table: str) -> list[dict[str, Any]]:
    resp = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=f"SELECT * FROM {table}",
        wait_timeout="0s",
    )
    _wait_statement(w, resp.statement_id)
    result = w.statement_execution.get_statement(resp.statement_id)
    if not result.result or not result.manifest:
        return []
    cols = [c.name for c in result.manifest.schema.columns]
    rows: list[dict[str, Any]] = []
    for chunk in result.result.data_array or []:
        rows.append(dict(zip(cols, chunk)))
    return rows


def upsert_narrations(
    conn,
    *,
    endpoint: str,
    json_rows: list[dict[str, Any]],
    md_rows: list[dict[str, Any]],
) -> None:
    md_by_key = {(r["facility_id"], r["capability"]): r for r in md_rows}
    with conn.cursor() as cur:
        for row in json_rows:
            key = (row["facility_id"], row["capability"])
            md_row = md_by_key.get(key)
            if md_row is None:
                continue
            assessment_json = row.get("assessment_json")
            if isinstance(assessment_json, str):
                assessment_json = json.loads(assessment_json)
            cur.execute(
                """
                INSERT INTO gold.capability_evidence_json (
                    facility_id, facility_name, capability,
                    evidence_strength_score, evidence_tier,
                    assessment_json, model_endpoint, narrated_at
                ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, NOW())
                ON CONFLICT (facility_id, capability) DO UPDATE SET
                    facility_name = EXCLUDED.facility_name,
                    evidence_strength_score = EXCLUDED.evidence_strength_score,
                    evidence_tier = EXCLUDED.evidence_tier,
                    assessment_json = EXCLUDED.assessment_json,
                    model_endpoint = EXCLUDED.model_endpoint,
                    narrated_at = NOW()
                """,
                (
                    row["facility_id"],
                    row.get("facility_name"),
                    row["capability"],
                    row.get("evidence_strength_score"),
                    row.get("evidence_tier"),
                    json.dumps(assessment_json),
                    endpoint,
                ),
            )
            cur.execute(
                """
                INSERT INTO gold.capability_evidence_md (
                    facility_id, facility_name, capability,
                    evidence_strength_score, evidence_tier,
                    assessment_md, model_endpoint, narrated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (facility_id, capability) DO UPDATE SET
                    facility_name = EXCLUDED.facility_name,
                    evidence_strength_score = EXCLUDED.evidence_strength_score,
                    evidence_tier = EXCLUDED.evidence_tier,
                    assessment_md = EXCLUDED.assessment_md,
                    model_endpoint = EXCLUDED.model_endpoint,
                    narrated_at = NOW()
                """,
                (
                    row["facility_id"],
                    md_row.get("facility_name"),
                    row["capability"],
                    md_row.get("evidence_strength_score"),
                    md_row.get("evidence_tier"),
                    md_row.get("assessment_md", ""),
                    endpoint,
                ),
            )
    conn.commit()


def narrate_via_databricks(
    rows: list[dict[str, Any]],
    *,
    profile: str | None,
    warehouse_id: str,
    endpoint: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    stage_scored_on_databricks(w, warehouse_id, rows)
    json_sql, md_sql = build_narration_sql(endpoint)
    _exec_sql(w, warehouse_id, json_sql)
    _exec_sql(w, warehouse_id, md_sql)
    json_rows = _fetch_table(w, warehouse_id, f"{STAGING_SCHEMA}.capability_evidence_json")
    md_rows = _fetch_table(w, warehouse_id, f"{STAGING_SCHEMA}.capability_evidence_md")
    return json_rows, md_rows


def narrate_via_serving(rows: list[dict[str, Any]], *, profile: str | None, endpoint: str) -> tuple[list[dict], list[dict]]:
    """Row-by-row fallback using the serving endpoint REST API (no ai_query)."""
    w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    host = w.config.host
    token = w.config.token
    if not host or not token:
        raise RuntimeError("Databricks auth required for serving-endpoint narration")

    import requests

    url = f"{host}/serving-endpoints/{endpoint}/invocations"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    json_rows: list[dict] = []
    md_rows: list[dict] = []

    for row in rows:
        ctx = row["evidence_context"]
        # JSON
        j_body = {
            "messages": [{"role": "user", "content": json_prompt(ctx)}],
            "response_format": json.loads(JSON_RESPONSE_FORMAT),
        }
        jr = requests.post(url, headers=headers, json=j_body, timeout=120)
        jr.raise_for_status()
        j_payload = jr.json()
        assessment_json = j_payload.get("choices", [{}])[0].get("message", {}).get("content", j_payload)
        if isinstance(assessment_json, str):
            assessment_json = json.loads(assessment_json)
        json_rows.append({**row, "assessment_json": assessment_json})

        # Markdown
        m_body = {
            "messages": [
                {
                    "role": "user",
                    "content": markdown_prompt(
                        ctx, row["facility_name"], row["capability_label"]
                    ),
                }
            ],
        }
        mr = requests.post(url, headers=headers, json=m_body, timeout=120)
        mr.raise_for_status()
        m_payload = mr.json()
        assessment_md = m_payload.get("choices", [{}])[0].get("message", {}).get("content", "")
        if isinstance(assessment_md, dict):
            assessment_md = json.dumps(assessment_md)
        md_rows.append({**row, "assessment_md": str(assessment_md).strip()})

    return json_rows, md_rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["local", "lakebase"], default="local")
    parser.add_argument("--dsn", help="Postgres DSN (local target).")
    parser.add_argument("--endpoint", help="Lakebase endpoint resource path.")
    parser.add_argument("--profile", help="Databricks CLI profile.")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--user", help="Lakebase login role.")
    parser.add_argument("--database", default="gift_india")
    parser.add_argument("--warehouse", default=DEFAULT_WAREHOUSE)
    parser.add_argument(
        "--agent-endpoint",
        default=os.getenv("EVIDENCE_AGENT_ENDPOINT", DEFAULT_ENDPOINT),
    )
    parser.add_argument("--limit", type=int, help="Cap rows narrated (for dev/test).")
    parser.add_argument("--capability", help="Narrate a single capability key.")
    parser.add_argument(
        "--mode",
        choices=["ai_query", "serving"],
        default="ai_query",
        help="ai_query runs batch SQL on Databricks; serving calls the endpoint per row.",
    )
    args = parser.parse_args(argv)

    if args.target == "lakebase":
        if not args.endpoint:
            parser.error("--endpoint is required for --target lakebase")
        dsn = _lakebase_dsn(args)
        where = f"Lakebase ({args.endpoint})"
    else:
        dsn = args.dsn or db.database_url() or db.LOCAL_DEFAULT_DSN
        where = "local Postgres"

    with db.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT to_regclass('gold.capability_scored') IS NOT NULL AS ok"
            )
            if not cur.fetchone()[0]:
                raise SystemExit(
                    "gold.capability_scored is missing — run `make dbt` first."
                )
            cur.execute(DDL)
        conn.commit()

        rows = fetch_scored(conn, limit=args.limit, capability=args.capability)
        if not rows:
            print("No scored rows to narrate.")
            return 0

        print(f"Narrating {len(rows):,} rows via {args.mode} ({args.agent_endpoint})…")
        if args.mode == "ai_query":
            json_rows, md_rows = narrate_via_databricks(
                rows,
                profile=args.profile,
                warehouse_id=args.warehouse,
                endpoint=args.agent_endpoint,
            )
        else:
            json_rows, md_rows = narrate_via_serving(
                rows, profile=args.profile, endpoint=args.agent_endpoint
            )

        upsert_narrations(
            conn,
            endpoint=args.agent_endpoint,
            json_rows=json_rows,
            md_rows=md_rows,
        )
        if args.target == "lakebase":
            with conn.cursor() as cur:
                cur.execute('ALTER SCHEMA gold OWNER TO "admins"')
                for table in ("capability_evidence_json", "capability_evidence_md"):
                    cur.execute(f'ALTER TABLE gold.{table} OWNER TO "admins"')
            conn.commit()

    print(f"Done — wrote {len(json_rows):,} JSON + Markdown narrations to {where}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
