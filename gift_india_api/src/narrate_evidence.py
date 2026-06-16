"""Narrate capability evidence via Agent Bricks and land JSON + Markdown in gold.*

Layer 1 (deterministic): ``make dbt`` builds ``gold.capability_scored``.
Layer 2 (LLM narration): calls a Databricks model serving endpoint, then upserts:

* ``gold.capability_evidence_json`` — structured assessment for the citation panel
* ``gold.capability_evidence_md`` — compact Markdown evidence card

Default mode is ``serving`` (REST per row, no SQL warehouse). Use ``--mode ai_query``
for batch ``ai_query`` on a SQL warehouse when it is running.

Usage::

    # Affordable pilot across 5 demo districts (no warehouse needed):
    python -m src.narrate_evidence --profile gift-india-mb --pilot --limit 50

    python -m src.narrate_evidence --target lakebase \\
        --endpoint projects/gift-india/branches/production/endpoints/primary \\
        --profile gift-india-mb --pilot

Environment:
    EVIDENCE_AGENT_ENDPOINT — serving endpoint (default databricks-gpt-oss-20b)
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
    EVIDENCE_GRADING_RUBRIC,
    JSON_RESPONSE_FORMAT,
    JSON_TASK,
    MARKDOWN_TASK,
    escape_for_sql_concat,
    json_prompt,
    markdown_prompt,
    stub_grade_sections,
    _prompt_intro,
)

DEFAULT_OWNER = "admins"
DEFAULT_WAREHOUSE = os.getenv("DATABRICKS_WAREHOUSE_ID", "234ccf680e359443")
STAGING_SCHEMA = os.getenv("EVIDENCE_STAGING_SCHEMA", "gift_india_gold")
STAGING_TABLE = f"{STAGING_SCHEMA}.capability_scored_staging"

# Demo districts for pilot narration — ordered coastal urban → desert rural.
# NOTE: ``%%`` escapes literal percent for psycopg parameter binding.
PILOT_GEO_WHERE = """(
    (state = 'Maharashtra' AND city ILIKE '%%mumbai%%')
    OR (state = 'Delhi' AND city IN ('New Delhi', 'Central Delhi'))
    OR (state = 'Karnataka' AND (city ILIKE '%%bengaluru%%' OR city ILIKE 'bangalore%%'))
    OR (state = 'Uttar Pradesh' AND city ILIKE '%%lucknow%%')
    OR (state = 'Rajasthan' AND city ILIKE '%%jaisalmer%%')
)"""

PILOT_GEO_ORDER = """
    CASE
        WHEN state = 'Maharashtra' AND city ILIKE '%%mumbai%%' THEN 1
        WHEN state = 'Delhi' AND city IN ('New Delhi', 'Central Delhi') THEN 2
        WHEN state = 'Karnataka'
             AND (city ILIKE '%%bengaluru%%' OR city ILIKE 'bangalore%%') THEN 3
        WHEN state = 'Uttar Pradesh' AND city ILIKE '%%lucknow%%' THEN 4
        WHEN state = 'Rajasthan' AND city ILIKE '%%jaisalmer%%' THEN 5
        ELSE 99
    END
"""

STUB_ENDPOINT = "stub/deterministic-template"

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

SCORED_SELECT = """
    s.facility_id, s.facility_name, s.capability, s.capability_label,
    s.evidence_strength_score, s.evidence_tier, s.evidence_context,
    s.supporting_count, s.contradicting_count, s.best_source, s.trust_signal
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


def fetch_scored(
    conn,
    *,
    limit: int | None,
    capability: str | None,
    pilot: bool = False,
    skip_existing: bool = False,
) -> list[dict[str, Any]]:
    clauses = ["(s.claimed OR s.trust_signal <> 'no_claim')"]
    params: list[Any] = []
    if capability:
        clauses.append("s.capability = %s")
        params.append(capability)
    if pilot:
        # Re-bind pilot geo filters to scored alias (city/state on capability_scored).
        pilot_where = PILOT_GEO_WHERE.replace("state =", "s.state =").replace(
            "city ", "s.city "
        )
        clauses.append(pilot_where)
    if skip_existing:
        # Keep stub rows eligible so a real LLM run replaces offline templates.
        clauses.append(
            f"""(j.facility_id IS NULL OR j.model_endpoint = {_sql_str(STUB_ENDPOINT)})"""
        )
    order = (
        f"{PILOT_GEO_ORDER.replace('state =', 's.state =').replace('city ', 's.city ')}, "
        "s.evidence_strength_score DESC, s.facility_name, s.capability"
        if pilot
        else "s.evidence_strength_score DESC, s.facility_name, s.capability"
    )
    limit_sql = ""
    if limit:
        limit_sql = "LIMIT %s"
        params.append(limit)
    join_sql = ""
    if skip_existing:
        join_sql = """
        LEFT JOIN gold.capability_evidence_json j
          ON j.facility_id = s.facility_id AND j.capability = s.capability
        """
    sql = f"""
        SELECT {SCORED_SELECT}
        FROM gold.capability_scored s
        {join_sql}
        WHERE {' AND '.join(clauses)}
        ORDER BY {order}
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


def _ensure_warehouse_ready(w: WorkspaceClient, warehouse_id: str) -> None:
    wh = w.warehouses.get(warehouse_id)
    state = wh.state.value if wh.state else "UNKNOWN"
    if state == "RUNNING":
        return
    if state == "STOPPED":
        try:
            w.warehouses.start(warehouse_id)
            return
        except Exception as exc:
            raise SystemExit(
                f"SQL warehouse {warehouse_id!r} is stopped and could not be started "
                f"({exc}).\n"
                "Use serving mode instead (no warehouse): "
                "make narrate-evidence MODE=serving AGENT=databricks-gpt-oss-20b "
                "PROFILE=gift-india-mb PILOT=1 LIMIT=50"
            ) from exc
    raise SystemExit(
        f"SQL warehouse {warehouse_id!r} is not ready (state={state}). "
        "Use MODE=serving to narrate via the model endpoint REST API."
    )


def _exec_sql(w: WorkspaceClient, warehouse_id: str, statement: str) -> None:
    _ensure_warehouse_ready(w, warehouse_id)
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
    json_prefix = escape_for_sql_concat(_prompt_intro(json_mode=True))
    json_suffix = escape_for_sql_concat(
        f"\n\n{EVIDENCE_GRADING_RUBRIC}\n\n{JSON_TASK}"
    )
    md_prefix = escape_for_sql_concat(_prompt_intro(json_mode=False))
    md_suffix = escape_for_sql_concat(
        f"\n\n{EVIDENCE_GRADING_RUBRIC}\n\n{MARKDOWN_TASK}"
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
      '{json_suffix}'
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
      '{md_suffix}'
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


class ServingQuotaError(Exception):
    """Databricks model serving blocked (daily limit, rate limit 0, etc.)."""

    def __init__(self, endpoint: str, detail: str) -> None:
        self.endpoint = endpoint
        self.detail = detail
        super().__init__(detail)


def _verdict_for_row(row: dict[str, Any]) -> str:
    contradicting = int(row.get("contradicting_count") or 0)
    trust = row.get("trust_signal") or ""
    if contradicting > 0 or trust == "weak_suspicious":
        return "Needs review"
    return {
        "Strong": "Confirmed",
        "Moderate": "Likely",
        "Weak": "Needs review",
        "Insufficient": "Unsupported",
    }.get(row.get("evidence_tier") or "", "Needs review")


def narrate_via_stub(rows: list[dict[str, Any]]) -> tuple[list[dict], list[dict]]:
    """Deterministic template narrations — no Databricks calls (dev / quota fallback)."""
    json_rows: list[dict] = []
    md_rows: list[dict] = []
    for row in rows:
        verdict = _verdict_for_row(row)
        tier = row.get("evidence_tier") or ""
        score = float(row.get("evidence_strength_score") or 0)
        supporting = int(row.get("supporting_count") or 0)
        contradicting = int(row.get("contradicting_count") or 0)
        best_source = row.get("best_source") or "on-record facility fields"
        trust = row.get("trust_signal") or ""
        review = contradicting > 0 or trust == "weak_suspicious"
        review_reason = (
            f"{contradicting} contradicting item(s) on record."
            if contradicting > 0
            else "Low trust signal — planner should confirm."
            if trust == "weak_suspicious"
            else "Evidence tier and counts look consistent."
        )
        rationale = (
            f"Pipeline scores this {row.get('capability_label', row['capability'])} claim as "
            f"{tier} ({score:.2f}) with {supporting} supporting and {contradicting} "
            f"contradicting evidence items. "
            f"Tiers: Strong ≥0.85, Moderate ≥0.65, Weak ≥0.45, else Insufficient."
        )
        grade_text, change_text = stub_grade_sections(
            tier=tier,
            score=score,
            supporting=supporting,
            contradicting=contradicting,
            trust=trust,
        )
        assessment_json = {
            "facility_id": row["facility_id"],
            "capability": row["capability"],
            "verdict": verdict,
            "evidence_tier": tier,
            "evidence_strength_score": score,
            "rationale": rationale,
            "specialty_corroboration": "See on-record specialties in the evidence context.",
            "citations": [
                {
                    "source": best_source,
                    "stance": "supporting" if supporting else "contextual",
                    "detail": f"{supporting} supporting / {contradicting} contradicting items",
                }
            ],
            "review_recommended": review,
            "review_reason": review_reason,
        }
        review_icon = "⚠️ Needs human review" if review else "✅ Looks solid"
        assessment_md = (
            f"### {row.get('facility_name', '')} — {row.get('capability_label', row['capability'])}\n"
            f"**Verdict:** {verdict}  ·  **Evidence:** {tier} ({score:.3f})\n\n"
            f"{rationale}\n\n"
            f"**Grade:** {grade_text}\n\n"
            f"**What would change this grade:**\n"
            f"{change_text}\n\n"
            f"**Why:**\n"
            f"- {supporting} supporting / {contradicting} contradicting pipeline items\n"
            f"- Trust signal: {trust or 'n/a'}\n"
            f"- Best source: {best_source}\n\n"
            f"**Citations:**\n"
            f"- {best_source}\n"
            f"- {supporting} supporting / {contradicting} contradicting items\n\n"
            f"**Review:** {review_icon} — {review_reason}\n"
        )
        json_rows.append({**row, "assessment_json": assessment_json})
        md_rows.append({**row, "assessment_md": assessment_md})
    return json_rows, md_rows


def _raise_serving_error(resp, endpoint: str) -> None:
    import requests

    detail = resp.text[:500]
    lower = detail.lower()
    if resp.status_code in (400, 403) and (
        "daily limit" in lower
        or "rate limit" in lower
        or "permission_denied" in lower
    ):
        raise ServingQuotaError(endpoint, detail)
    raise requests.HTTPError(
        f"{resp.status_code} from {endpoint}: {detail}", response=resp
    )


def _extract_message_content(message: dict[str, Any] | Any) -> str:
    """Normalize chat completion content (string or gpt-oss content blocks)."""
    if not isinstance(message, dict):
        return str(message or "")
    content = message.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return str(content).strip()
    text_parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and block.get("text"):
            text_parts.append(str(block["text"]).strip())
    if text_parts:
        return "\n".join(text_parts).strip()
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "reasoning":
            continue
        for part in block.get("summary") or []:
            if isinstance(part, dict) and part.get("text"):
                text_parts.append(str(part["text"]).strip())
    return "\n".join(text_parts).strip()


def _serving_request_context(profile: str | None, endpoint: str) -> tuple[str, dict[str, str]]:
    w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    host = w.config.host
    if not host:
        raise RuntimeError(
            "Databricks host not configured. Run `databricks auth login --profile <name>`."
        )
    headers = {**w.config.authenticate(), "Content-Type": "application/json"}
    url = f"{host}/serving-endpoints/{endpoint}/invocations"
    return url, headers


def _post_serving(
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    endpoint: str,
    *,
    max_attempts: int = 10,
    base_delay: float = 3.0,
):
    import requests

    for attempt in range(max_attempts):
        resp = requests.post(url, headers=headers, json=body, timeout=120)
        if resp.status_code == 429:
            delay = min(base_delay * (2**attempt), 120.0)
            print(f"  rate limited on {endpoint} — retry in {delay:.0f}s…", flush=True)
            time.sleep(delay)
            continue
        if resp.status_code >= 400:
            _raise_serving_error(resp, endpoint)
        return resp
    raise ServingQuotaError(endpoint, "rate limit retries exhausted")


def _narrate_single_via_serving(
    row: dict[str, Any],
    *,
    url: str,
    headers: dict[str, str],
    endpoint: str,
    serve_delay: float = 1.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    ctx = row["evidence_context"]
    j_body = {
        "messages": [{"role": "user", "content": json_prompt(ctx)}],
        "response_format": json.loads(JSON_RESPONSE_FORMAT),
    }
    jr = _post_serving(url, headers, j_body, endpoint)
    j_payload = jr.json()
    j_message = j_payload.get("choices", [{}])[0].get("message", {})
    raw_json = _extract_message_content(j_message) or j_payload
    if isinstance(raw_json, dict):
        assessment_json = raw_json
    else:
        assessment_json = json.loads(str(raw_json))
    json_row = {**row, "assessment_json": assessment_json}

    if serve_delay > 0:
        time.sleep(serve_delay)

    m_body = {
        "messages": [
            {
                "role": "user",
                "content": markdown_prompt(ctx, row["facility_name"], row["capability_label"]),
            }
        ],
    }
    mr = _post_serving(url, headers, m_body, endpoint)
    m_payload = mr.json()
    m_message = m_payload.get("choices", [{}])[0].get("message", {})
    assessment_md = _extract_message_content(m_message)
    md_row = {**row, "assessment_md": assessment_md}
    if serve_delay > 0:
        time.sleep(serve_delay)
    return json_row, md_row


def narrate_via_serving(
    rows: list[dict[str, Any]],
    *,
    profile: str | None,
    endpoint: str,
    conn=None,
    upsert_endpoint: str | None = None,
    progress_every: int = 25,
    serve_delay: float = 1.0,
) -> tuple[list[dict], list[dict]]:
    """Row-by-row serving-endpoint narration; upserts to Postgres after each row when conn is set."""
    url, headers = _serving_request_context(profile, endpoint)
    json_rows: list[dict] = []
    md_rows: list[dict] = []
    total = len(rows)

    for i, row in enumerate(rows, start=1):
        json_row, md_row = _narrate_single_via_serving(
            row,
            url=url,
            headers=headers,
            endpoint=endpoint,
            serve_delay=serve_delay,
        )
        json_rows.append(json_row)
        md_rows.append(md_row)
        if conn is not None and upsert_endpoint:
            upsert_narrations(
                conn,
                endpoint=upsert_endpoint,
                json_rows=[json_row],
                md_rows=[md_row],
            )
        if progress_every and (i % progress_every == 0 or i == total):
            print(f"  … {i:,}/{total:,} narrated", flush=True)

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
        "--pilot",
        action="store_true",
        help="Limit to 5 demo districts (Mumbai, Delhi, Bengaluru, Lucknow, Jaisalmer) "
        "in that priority order.",
    )
    parser.add_argument(
        "--mode",
        choices=["ai_query", "serving", "stub"],
        default=os.getenv("EVIDENCE_NARRATION_MODE", "serving"),
        help="serving = REST per row; ai_query = batch SQL on a warehouse; "
        "stub = local template (no Databricks, for dev/quota limits).",
    )
    parser.add_argument(
        "--fallback-stub",
        action=argparse.BooleanOptionalAction,
        default=os.getenv("EVIDENCE_FALLBACK_STUB", "true").lower() not in ("0", "false", "no"),
        help="When serving/ai_query hits Databricks quota limits, use stub templates "
        "(default: on). Pass --no-fallback-stub to fail instead.",
    )
    parser.add_argument(
        "--serve-delay",
        type=float,
        default=float(os.getenv("EVIDENCE_SERVE_DELAY", "1.5")),
        help="Seconds to pause between serving calls (reduces 429 rate limits).",
    )
    parser.add_argument(
        "--skip-existing",
        action=argparse.BooleanOptionalAction,
        default=os.getenv("EVIDENCE_SKIP_EXISTING", "true").lower() not in ("0", "false", "no"),
        help="Skip facility×capability rows already narrated by a real model. "
        "Stub templates remain eligible for replacement (default: on).",
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

        rows = fetch_scored(
            conn,
            limit=args.limit,
            capability=args.capability,
            pilot=args.pilot,
            skip_existing=args.skip_existing,
        )
        if not rows:
            print("No scored rows to narrate.")
            if args.skip_existing:
                print("(All matching rows already have real LLM narrations — use --no-skip-existing to force.)")
            return 0

        geo = "pilot districts" if args.pilot else "all geographies"
        endpoint_label = (
            STUB_ENDPOINT if args.mode == "stub" else args.agent_endpoint
        )
        skip_note = " · skip-existing" if args.skip_existing else ""
        print(
            f"Narrating {len(rows):,} rows ({geo}) via {args.mode} "
            f"({endpoint_label}){skip_note}…"
        )
        if args.mode == "ai_query":
            json_rows, md_rows = narrate_via_databricks(
                rows,
                profile=args.profile,
                warehouse_id=args.warehouse,
                endpoint=args.agent_endpoint,
            )
            upsert_narrations(
                conn,
                endpoint=endpoint_label,
                json_rows=json_rows,
                md_rows=md_rows,
            )
        elif args.mode == "stub":
            json_rows, md_rows = narrate_via_stub(rows)
            upsert_narrations(
                conn,
                endpoint=endpoint_label,
                json_rows=json_rows,
                md_rows=md_rows,
            )
        else:
            json_rows, md_rows = narrate_via_serving(
                rows,
                profile=args.profile,
                endpoint=args.agent_endpoint,
                conn=conn,
                upsert_endpoint=endpoint_label,
                serve_delay=args.serve_delay,
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
