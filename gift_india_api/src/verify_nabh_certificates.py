"""Agent Bricks NABH certificate verification — parse scope PDFs and score Virtue claims.

Layer 1.5 between bronze NABH accreditation data and gold capability trust scores.
For each certificate PDF under ``data/nabh/certificates/``:

1. **Parse** with `Agent Bricks Document Parsing`_ (``ai_parse_document`` v2.0 on a UC
   volume) then ``ai_extract`` for structured scope fields — see the official
   `Document Parsing`_ guide. Local ``pypdf`` is the offline fallback.
2. **Resolve** the certificate to a Virtue ``facility_id`` via ``gold.facility_nabh``
   and Splink ``bronze.merge_candidates`` match probability.
3. **Cross-reference** ``bronze.facility_capability_assessments_virtue`` claims.
4. **Score** each facility × capability deterministically.

.. _Agent Bricks Document Parsing: https://docs.databricks.com/aws/en/generative-ai/agent-bricks/document-parsing
.. _Document Parsing: https://docs.databricks.com/aws/en/generative-ai/agent-bricks/document-parsing

Results land in ``bronze.nabh_certificate_extractions`` and
``bronze.nabh_capability_verifications``. Run ``make dbt`` afterward.

Usage::

    # Agent Bricks (uploads PDFs → UC volume → ai_parse_document → ai_extract):
    make verify-nabh PROFILE=gift-india-mb

    # Offline dev fallback:
    make verify-nabh MODE=local LIMIT=20

    python -m src.verify_nabh_certificates --mode databricks --profile gift-india-mb
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

from . import db
from .jci_scraper import brand_key, normalize_name

_REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CERT_DIR = _REPO_ROOT / "data" / "nabh" / "certificates"
DEFAULT_WAREHOUSE = os.getenv("DATABRICKS_WAREHOUSE_ID", "234ccf680e359443")
DEFAULT_VOLUME = os.getenv(
    "NABH_CERT_VOLUME", "/Volumes/workspace/default/nabh_certificates"
)
PARSE_METHOD_AGENT_BRICKS = "agent_bricks_document_parsing"

CAPABILITIES = ("icu", "maternity", "emergency", "oncology", "trauma", "nicu")

# NABH scope-line keywords → GIFT capability keys (case-insensitive substring).
SCOPE_CAPABILITY_PATTERNS: dict[str, tuple[str, ...]] = {
    "maternity": (
        "obstetric",
        "gynaecolog",
        "gynecolog",
        "labour ward",
        "labor ward",
        "antenatal",
        "maternity",
    ),
    "emergency": (
        "emergency medicine",
        "emergency department",
        "emergency dept",
        "casualty",
        "accident and emergency",
        "emergency care",
    ),
    "trauma": (
        "trauma",
        "orthopaedic surgery",
        "orthopedic surgery",
        "accident",
        "general surgery",
    ),
    "oncology": (
        "oncolog",
        "cancer",
        "chemotherapy",
        "radiotherapy",
        "radiation oncol",
    ),
    "icu": (
        "critical care",
        "intensive care",
        "icu",
        "hdu",
        "ventilator",
        "dialysis",
    ),
    "nicu": (
        "neonatal",
        "nicu",
        "paediatric intensive",
        "pediatric intensive",
    ),
}

EXTRACTION_DDL = """
CREATE TABLE IF NOT EXISTS bronze.nabh_certificate_extractions (
    extraction_id           text PRIMARY KEY,
    reference_no              text NOT NULL,
    pdf_path                  text NOT NULL,
    nabh_org_id               text,
    nabh_name                 text,
    accreditation_program     text,
    valid_from                date,
    valid_thru                date,
    scope_items               jsonb NOT NULL DEFAULT '[]'::jsonb,
    parsed_capabilities       jsonb NOT NULL DEFAULT '{}'::jsonb,
    parsed_document           jsonb,
    raw_text                  text,
    parse_method              text NOT NULL,
    parse_confidence          numeric,
    parsed_at                 timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nabh_certificate_extractions_ref_idx
    ON bronze.nabh_certificate_extractions (reference_no);
"""

VERIFICATION_DDL = """
CREATE TABLE IF NOT EXISTS bronze.nabh_capability_verifications (
    facility_id               text NOT NULL,
    capability                text NOT NULL,
    reference_no              text NOT NULL,
    nabh_org_id               text,
    virtue_claimed            boolean,
    virtue_trust_signal       text,
    virtue_trust_score        numeric,
    certificate_supports      boolean NOT NULL DEFAULT false,
    certificate_scope_snippet text,
    nabh_match_method         text,
    nabh_match_confidence     numeric,
    splink_match_probability  numeric,
    verification_score        numeric NOT NULL,
    verification_signal       text NOT NULL,
    verified_at               timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (facility_id, capability, reference_no)
);

CREATE INDEX IF NOT EXISTS nabh_capability_verifications_facility_idx
    ON bronze.nabh_capability_verifications (facility_id);
CREATE INDEX IF NOT EXISTS nabh_capability_verifications_signal_idx
    ON bronze.nabh_capability_verifications (verification_signal);
"""

AI_EXTRACT_FIELDS = (
    '["reference_no", "facility_name", "accreditation_program", '
    '"valid_from", "valid_thru", "scope_items"]'
)
AI_EXTRACT_INSTRUCTIONS = (
    "NABH certificate-and-scope PDF from portal.nabh.co. Extract the accredited "
    "organisation name, certificate reference number, validity dates, programme "
    "(Hospitals, SHCO, Dental, Eye Care, etc.), and every clinical or diagnostic "
    "service line listed under Scope of Accreditation as scope_items (array of strings)."
)


@dataclass
class CertificateParse:
    reference_no: str
    pdf_path: str
    nabh_name: str | None
    accreditation_program: str | None
    valid_from: date | None
    valid_thru: date | None
    scope_items: list[str]
    parsed_capabilities: dict[str, dict[str, Any]]
    raw_text: str
    parse_method: str
    parse_confidence: float
    parsed_document: dict[str, Any] | None = None


def _sha16(*parts: str) -> str:
    payload = "|".join(parts)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def reference_from_pdf(path: Path) -> str:
    return path.stem.upper()


def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _clean_scope_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"^[x×•\-–]\s*", "", line, flags=re.I)
    line = re.sub(r"\s+", " ", line)
    return line.strip(" .")


def extract_scope_items(text: str) -> list[str]:
    """Pull bullet scope lines from certificate free text."""
    items: list[str] = []
    in_scope = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if re.search(r"scope of accreditation", line, re.I):
            in_scope = True
            continue
        if in_scope and re.search(
            r"^(date of first accreditation|valid from|certificate no|total number)",
            line,
            re.I,
        ):
            break
        if in_scope and re.match(r"^[x×•\-–]\s+", line, re.I):
            cleaned = _clean_scope_line(line)
            if cleaned and len(cleaned) > 2:
                items.append(cleaned)
    if not items:
        for line in text.splitlines():
            if re.match(r"^[x×•\-–]\s+", line.strip(), re.I):
                cleaned = _clean_scope_line(line.strip())
                if cleaned and len(cleaned) > 2:
                    items.append(cleaned)
    return items


def extract_facility_name(text: str, reference_no: str) -> str | None:
    """Heuristic: facility name block sits after scope bullets, before address/dates."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    ref_idx = next(
        (i for i, ln in enumerate(lines) if reference_no.upper() in ln.upper()),
        -1,
    )
    date_pat = re.compile(
        r"date of first accreditation|valid from|valid thru|certificate no",
        re.I,
    )
    skip_pat = re.compile(
        r"nabh|scope of accreditation|chief executive|verify the authenticity|"
        r"national accreditation|phone:|email:|website:|clinical services|"
        r"diagnostic services|laboratory services|support services|professions allied",
        re.I,
    )
    candidates: list[str] = []
    for i, ln in enumerate(lines):
        if skip_pat.search(ln) or re.match(r"^[x×•\-–]\s", ln):
            continue
        if date_pat.search(ln):
            continue
        if reference_no.upper() in ln.upper() or re.match(r"^SI No\.", ln, re.I):
            continue
        if re.match(r"^\*?\d{5,6}\*?$", ln):
            continue
        if len(ln) < 4 or len(ln) > 120:
            continue
        if ref_idx >= 0 and i < ref_idx:
            continue
        if re.search(r"\d{3,}", ln) and re.search(r"(road|street|nagar|district|pin)", ln, re.I):
            continue
        candidates.append(ln)
    if not candidates:
        return None
    # Prefer lines that look like org names (title case, not all-caps headers).
    for ln in candidates:
        if ln[0].isupper() and not ln.isupper():
            return ln
    return candidates[0]


def extract_validity(text: str) -> tuple[date | None, date | None]:
    valid_from = valid_thru = None
    m_from = re.search(r"Valid from\s*:\s*([A-Za-z]+ \d{1,2}, \d{4})", text, re.I)
    m_thru = re.search(r"Valid thru\s*:\s*([A-Za-z]+ \d{1,2}, \d{4})", text, re.I)
    if m_from:
        valid_from = _parse_date(m_from.group(1))
    if m_thru:
        valid_thru = _parse_date(m_thru.group(1))
    return valid_from, valid_thru


def program_from_reference(reference_no: str) -> str | None:
    prefix = reference_no.split("-", 1)[0].upper()
    return {
        "H": "Hospitals",
        "D": "Dental",
        "SHCO": "SHCO",
        "EYE": "Eye Care Organisation",
    }.get(prefix, prefix)


def _scope_line_matches(line: str, patterns: tuple[str, ...]) -> bool:
    lower = line.lower()
    for pat in patterns:
        if pat not in lower:
            continue
        # Avoid dental orthodontics falsely matching trauma orthopaedic patterns.
        if "orthodont" in lower and "orthop" in pat:
            continue
        return True
    return False


def map_scope_to_capabilities(scope_items: list[str]) -> dict[str, dict[str, Any]]:
    """Map NABH scope lines to GIFT capabilities with supporting snippets."""
    joined = " | ".join(scope_items).lower()
    out: dict[str, dict[str, Any]] = {}
    for cap, patterns in SCOPE_CAPABILITY_PATTERNS.items():
        hits = [item for item in scope_items if _scope_line_matches(item, patterns)]
        if hits:
            out[cap] = {
                "supports": True,
                "snippet": hits[0],
                "scope_items": hits,
            }
        elif any(_scope_line_matches(joined, (pat,)) for pat in patterns):
            out[cap] = {
                "supports": True,
                "snippet": next(pat for pat in patterns if pat in joined),
                "scope_items": scope_items[:3],
            }
    for cap in CAPABILITIES:
        out.setdefault(
            cap,
            {"supports": False, "snippet": None, "scope_items": []},
        )
    return out


def parse_certificate_text(
    text: str,
    *,
    reference_no: str,
    pdf_path: Path,
    parse_method: str,
    parse_confidence: float = 0.85,
    structured: dict[str, Any] | None = None,
    parsed_document: dict[str, Any] | None = None,
) -> CertificateParse:
    if structured:
        scope_items = [str(s) for s in structured.get("scope_items") or []]
        if not scope_items:
            scope_items = extract_scope_items(text)
        nabh_name = structured.get("facility_name") or extract_facility_name(text, reference_no)
        if nabh_name and re.search(
            r"date of|valid from|valid thru|certificate no|previous cycle|first accreditation",
            nabh_name,
            re.I,
        ):
            nabh_name = extract_facility_name(text, reference_no)
        valid_from = _parse_date(structured.get("valid_from")) or extract_validity(text)[0]
        valid_thru = _parse_date(structured.get("valid_thru")) or extract_validity(text)[1]
        program = structured.get("accreditation_program") or program_from_reference(reference_no)
    else:
        scope_items = extract_scope_items(text)
        nabh_name = extract_facility_name(text, reference_no)
        valid_from, valid_thru = extract_validity(text)
        program = program_from_reference(reference_no)

    return CertificateParse(
        reference_no=reference_no,
        pdf_path=str(pdf_path),
        nabh_name=nabh_name,
        accreditation_program=program,
        valid_from=valid_from,
        valid_thru=valid_thru,
        scope_items=scope_items,
        parsed_capabilities=map_scope_to_capabilities(scope_items),
        raw_text=text,
        parse_method=parse_method,
        parse_confidence=parse_confidence,
        parsed_document=parsed_document,
    )


def extract_pdf_local(path: Path) -> str:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(str(path), strict=False)
    except PdfReadError as exc:
        raise ValueError(f"unreadable PDF {path.name}: {exc}") from exc
    parts: list[str] = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except PdfReadError:
            continue
    text = "\n".join(parts).strip()
    if not text:
        raise ValueError(f"no extractable text in {path.name}")
    return text


def _sql_str(val: Any) -> str:
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


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
        w.warehouses.start(warehouse_id)
        return
    raise RuntimeError(
        f"SQL warehouse {warehouse_id!r} is not ready (state={state}). "
        "Start it in the Databricks workspace or set DATABRICKS_WAREHOUSE_ID."
    )


def _exec_sql(w: WorkspaceClient, warehouse_id: str, statement: str) -> str:
    _ensure_warehouse_ready(w, warehouse_id)
    resp = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=statement,
        wait_timeout="0s",
    )
    _wait_statement(w, resp.statement_id)
    return resp.statement_id


def _fetch_rows(w: WorkspaceClient, statement_id: str) -> list[dict[str, Any]]:
    result = w.statement_execution.get_statement(statement_id)
    if not result.result or not result.manifest:
        return []
    cols = [c.name for c in result.manifest.schema.columns]
    rows: list[dict[str, Any]] = []
    for chunk in result.result.data_array or []:
        rows.append(dict(zip(cols, chunk)))
    return rows


def elements_to_text(elements: list[dict[str, Any]] | None) -> str:
    """Flatten ai_parse_document v2.0 ``document.elements`` into plain text."""
    if not elements:
        return ""
    parts: list[str] = []
    for el in elements:
        if not isinstance(el, dict):
            continue
        el_type = str(el.get("type") or "")
        content = str(el.get("content") or "").strip()
        if not content:
            continue
        if el_type in {
            "text",
            "title",
            "section_header",
            "table",
            "caption",
            "page_header",
            "page_footer",
            "footnote",
        }:
            parts.append(content)
    return "\n".join(parts)


def _parse_structured_extract(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    # ai_extract may wrap fields under a single key or return flat dict.
    if len(raw) == 1:
        only_val = next(iter(raw.values()))
        if isinstance(only_val, dict):
            return only_val
    return raw


def build_agent_bricks_parse_sql(volume_path: str) -> str:
    """SQL pipeline: READ_FILES → ai_parse_document → ai_extract (Agent Bricks)."""
    glob = volume_path.rstrip("/")
    fields = AI_EXTRACT_FIELDS.replace("'", "\\'")
    instructions = AI_EXTRACT_INSTRUCTIONS.replace("'", "\\'")
    return f"""
WITH source_files AS (
  SELECT path, content
  FROM READ_FILES('{glob}', format => 'binaryFile')
  WHERE lower(path) LIKE '%.pdf'
),
parsed_docs AS (
  SELECT
    upper(regexp_extract(path, '([^/]+)\\\\.pdf$', 1)) AS reference_no,
    path,
    ai_parse_document(content, map('version', '2.0')) AS parsed_content
  FROM source_files
),
with_text AS (
  SELECT
    reference_no,
    path,
    parsed_content,
    concat_ws(
      '\\n',
      transform(
        filter(
          from_json(
            to_json(parsed_content:document:elements),
            'array<struct<type:string,content:string>>'
          ),
          x -> x.type IN (
            'text', 'title', 'section_header', 'table',
            'caption', 'page_header', 'page_footer', 'footnote'
          )
        ),
        x -> x.content
      )
    ) AS raw_text
  FROM parsed_docs
),
extracted AS (
  SELECT
    reference_no,
    path,
    parsed_content,
    raw_text,
    ai_extract(
      parsed_content,
      '{fields}',
      map('instructions', '{instructions}')
    ) AS structured
  FROM with_text
)
SELECT
  reference_no,
  path,
  raw_text,
  to_json(parsed_content) AS parsed_document_json,
  to_json(structured) AS structured_json
FROM extracted
"""


def ensure_uc_volume(
    w: WorkspaceClient,
    warehouse_id: str,
    volume_path: str,
) -> None:
    """Best-effort CREATE VOLUME (requires USE SCHEMA on an existing catalog)."""
    parts = volume_path.strip("/").split("/")
    if len(parts) < 4 or parts[0] != "Volumes":
        return
    catalog, schema, volume = parts[1], parts[2], parts[3]
    try:
        _exec_sql(
            w,
            warehouse_id,
            f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.{volume}",
        )
    except RuntimeError as exc:
        print(
            f"  note: could not auto-create volume {catalog}.{schema}.{volume} "
            f"({exc}); will attempt upload if it already exists.",
            flush=True,
        )


def upload_pdfs_to_volume(
    paths: list[Path],
    volume_path: str,
    *,
    profile: str | None,
    warehouse_id: str,
) -> int:
    """Upload local certificate PDFs to a Unity Catalog volume for READ_FILES."""
    w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    ensure_uc_volume(w, warehouse_id, volume_path)
    base = volume_path.rstrip("/")
    uploaded = 0
    for path in paths:
        dest = f"{base}/{path.name}"
        try:
            with path.open("rb") as handle:
                w.files.upload(dest, handle, overwrite=True)
            uploaded += 1
        except Exception as exc:
            raise RuntimeError(
                f"Failed to upload {path.name} to {dest}: {exc}\n"
                "Create the UC volume first (Agents → Document Parsing → select from "
                "catalog) or ask an admin for WRITE on the volume. See "
                "https://docs.databricks.com/aws/en/generative-ai/agent-bricks/document-parsing"
            ) from exc
    return uploaded


def parse_via_agent_bricks(
    volume_path: str,
    *,
    profile: str | None,
    warehouse_id: str,
) -> dict[str, dict[str, Any]]:
    """Run Agent Bricks Document Parsing on all PDFs in a UC volume."""
    w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    sql = build_agent_bricks_parse_sql(volume_path)
    sid = _exec_sql(w, warehouse_id, sql)
    rows = _fetch_rows(w, sid)
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        ref = str(row.get("reference_no") or "").upper()
        if not ref:
            continue
        parsed_doc = None
        structured = None
        raw_doc = row.get("parsed_document_json")
        raw_struct = row.get("structured_json")
        if raw_doc:
            try:
                parsed_doc = json.loads(raw_doc) if isinstance(raw_doc, str) else raw_doc
            except (json.JSONDecodeError, TypeError):
                parsed_doc = None
        structured = _parse_structured_extract(raw_struct)
        out[ref] = {
            "reference_no": ref,
            "path": row.get("path"),
            "raw_text": str(row.get("raw_text") or ""),
            "structured": structured,
            "parsed_document": parsed_doc,
        }
    return out


def certificate_parse_from_agent_bricks(
    ref: str,
    local_path: Path,
    row: dict[str, Any],
) -> CertificateParse | None:
    raw_text = str(row.get("raw_text") or "").strip()
    structured = row.get("structured")
    if not raw_text and not structured:
        return None
    if not raw_text and isinstance(structured, dict):
        items = structured.get("scope_items") or []
        raw_text = "\n".join(str(i) for i in items)
    return parse_certificate_text(
        raw_text or "",
        reference_no=ref,
        pdf_path=local_path,
        parse_method=PARSE_METHOD_AGENT_BRICKS,
        parse_confidence=0.95,
        structured=structured if isinstance(structured, dict) else None,
        parsed_document=row.get("parsed_document"),
    )


def compute_verification_score(
    *,
    certificate_supports: bool,
    virtue_claimed: bool | None,
    nabh_match_confidence: float,
    splink_match_probability: float,
) -> tuple[float, str]:
    """Deterministic verification score — SQL-supervised, not LLM-decided."""
    cert_weight = 1.0 if certificate_supports else 0.15
    if virtue_claimed is None:
        virtue_align = 0.5
    elif virtue_claimed and certificate_supports:
        virtue_align = 1.0
    elif virtue_claimed and not certificate_supports:
        virtue_align = 0.2
    elif not virtue_claimed and certificate_supports:
        virtue_align = 0.7
    else:
        virtue_align = 0.5

    score = round(
        0.35 * cert_weight
        + 0.25 * virtue_align
        + 0.25 * max(0.0, min(1.0, nabh_match_confidence))
        + 0.15 * max(0.0, min(1.0, splink_match_probability)),
        4,
    )

    if virtue_claimed and certificate_supports and score >= 0.75:
        signal = "corroborated"
    elif virtue_claimed and not certificate_supports:
        signal = "contradicted"
    elif score >= 0.55:
        signal = "partial"
    else:
        signal = "unverified"
    return score, signal


def load_nabh_orgs(conn) -> dict[str, dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT nabh_org_id, nabh_name, reference_no, accreditation_program,
                   match_name, brand_key, state, city
            FROM bronze.facilities_nabh
            WHERE reference_no IS NOT NULL
            """
        )
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return {str(r["reference_no"]).upper(): r for r in rows}


def load_facility_nabh_links(conn) -> dict[str, dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT to_regclass('gold.facility_nabh') IS NOT NULL AS ok
            """
        )
        if not cur.fetchone()[0]:
            return {}
        cur.execute(
            """
            SELECT facility_id, nabh_org_id, nabh_reference_no, nabh_organization_name,
                   match_method, match_confidence
            FROM gold.facility_nabh
            """
        )
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        ref = str(r.get("nabh_reference_no") or "").upper()
        if ref:
            out[ref] = r
    return out


def load_virtue_assessments(conn) -> dict[tuple[str, str], dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT facility_id, capability, claimed, trust_signal, trust_score
            FROM bronze.facility_capability_assessments_virtue
            """
        )
        cols = [d.name for d in cur.description]
        return {
            (r[0], r[1]): dict(zip(cols, r))
            for r in cur.fetchall()
        }


def load_splink_probs(conn) -> dict[tuple[str, str], float]:
    """Best Splink match_probability linking virtue facilities to nabh orgs."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT to_regclass('bronze.merge_candidates') IS NOT NULL AS ok
            """
        )
        if not cur.fetchone()[0]:
            return {}
        cur.execute(
            """
            SELECT left_source, left_id, right_source, right_id, match_probability
            FROM bronze.merge_candidates
            WHERE (left_source = 'virtue' AND right_source = 'nabh')
               OR (left_source = 'nabh' AND right_source = 'virtue')
            """
        )
        best: dict[tuple[str, str], float] = {}
        for left_src, left_id, right_src, right_id, prob in cur.fetchall():
            if left_src == "virtue":
                key = (left_id, right_id)
            else:
                key = (right_id, left_id)
            best[key] = max(best.get(key, 0.0), float(prob))
        return best


def resolve_facility_for_cert(
    parse: CertificateParse,
    *,
    nabh_orgs: dict[str, dict[str, Any]],
    facility_links: dict[str, dict[str, Any]],
    conn,
) -> tuple[str | None, float, str | None, str | None]:
    """Return (facility_id, nabh_match_confidence, match_method, nabh_org_id)."""
    ref = parse.reference_no.upper()
    if ref in facility_links:
        link = facility_links[ref]
        return (
            link["facility_id"],
            float(link.get("match_confidence") or 0.0),
            link.get("match_method"),
            link.get("nabh_org_id"),
        )

    org = nabh_orgs.get(ref)
    if not org:
        return None, 0.0, None, None

    match_name = org.get("match_name") or ""
    brand = org.get("brand_key") or ""
    state = (org.get("state") or "").lower()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT facility_id, name, state, match_confidence FROM bronze.facilities_virtue"
        )
        cols = [d.name for d in cur.description]
        facilities = [dict(zip(cols, r)) for r in cur.fetchall()]

    best_id: str | None = None
    best_conf = 0.0
    best_method: str | None = None
    for f in facilities:
        if state and (f.get("state") or "").lower() != state:
            continue
        fn = normalize_name(f.get("name") or "")
        fb = brand_key(f.get("name") or "")
        if match_name and fn == match_name:
            conf = 1.0
            method = "inline_exact_name_state"
        elif brand and fb == brand:
            conf = 0.70
            method = "inline_brand_state"
        else:
            continue
        if conf > best_conf:
            best_id = f["facility_id"]
            best_conf = conf
            best_method = method
    if best_id:
        return best_id, best_conf, best_method, org.get("nabh_org_id")

    # Parsed certificate name fallback.
    if parse.nabh_name:
        nm = normalize_name(parse.nabh_name)
        bk = brand_key(parse.nabh_name)
        for f in facilities:
            fn = normalize_name(f.get("name") or "")
            fb = brand_key(f.get("name") or "")
            if fn == nm:
                return (
                    f["facility_id"],
                    float(f.get("match_confidence") or 0.5),
                    "cert_name_fallback",
                    org.get("nabh_org_id"),
                )
            if bk and fb == bk:
                return (
                    f["facility_id"],
                    float(f.get("match_confidence") or 0.5) * 0.85,
                    "cert_brand_fallback",
                    org.get("nabh_org_id"),
                )

    return None, 0.0, None, org.get("nabh_org_id")


def build_verification_rows(
    parse: CertificateParse,
    *,
    facility_id: str | None,
    nabh_match_confidence: float,
    nabh_match_method: str | None,
    nabh_org_id: str | None,
    virtue: dict[tuple[str, str], dict[str, Any]],
    splink: dict[tuple[str, str], float],
) -> list[dict[str, Any]]:
    if not facility_id:
        return []
    rows: list[dict[str, Any]] = []
    splink_prob = 0.0
    if nabh_org_id:
        splink_prob = splink.get((facility_id, nabh_org_id), 0.0)

    for cap in CAPABILITIES:
        cap_info = parse.parsed_capabilities.get(cap, {})
        cert_supports = bool(cap_info.get("supports"))
        snippet = cap_info.get("snippet")
        v = virtue.get((facility_id, cap), {})
        virtue_claimed = v.get("claimed")
        score, signal = compute_verification_score(
            certificate_supports=cert_supports,
            virtue_claimed=virtue_claimed,
            nabh_match_confidence=nabh_match_confidence,
            splink_match_probability=splink_prob,
        )
        rows.append(
            {
                "facility_id": facility_id,
                "capability": cap,
                "reference_no": parse.reference_no,
                "nabh_org_id": nabh_org_id,
                "virtue_claimed": virtue_claimed,
                "virtue_trust_signal": v.get("trust_signal"),
                "virtue_trust_score": v.get("trust_score"),
                "certificate_supports": cert_supports,
                "certificate_scope_snippet": snippet,
                "nabh_match_method": nabh_match_method,
                "nabh_match_confidence": nabh_match_confidence,
                "splink_match_probability": splink_prob,
                "verification_score": score,
                "verification_signal": signal,
            }
        )
    return rows


def upsert_extractions(conn, parses: list[CertificateParse], nabh_orgs: dict) -> None:
    with conn.cursor() as cur:
        for p in parses:
            org = nabh_orgs.get(p.reference_no.upper(), {})
            eid = _sha16(p.reference_no, p.pdf_path)
            cur.execute(
                """
                INSERT INTO bronze.nabh_certificate_extractions (
                    extraction_id, reference_no, pdf_path, nabh_org_id, nabh_name,
                    accreditation_program, valid_from, valid_thru,
                    scope_items, parsed_capabilities, parsed_document, raw_text,
                    parse_method, parse_confidence, parsed_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s, NOW()
                )
                ON CONFLICT (extraction_id) DO UPDATE SET
                    nabh_org_id = EXCLUDED.nabh_org_id,
                    nabh_name = EXCLUDED.nabh_name,
                    accreditation_program = EXCLUDED.accreditation_program,
                    valid_from = EXCLUDED.valid_from,
                    valid_thru = EXCLUDED.valid_thru,
                    scope_items = EXCLUDED.scope_items,
                    parsed_capabilities = EXCLUDED.parsed_capabilities,
                    parsed_document = EXCLUDED.parsed_document,
                    raw_text = EXCLUDED.raw_text,
                    parse_method = EXCLUDED.parse_method,
                    parse_confidence = EXCLUDED.parse_confidence,
                    parsed_at = NOW()
                """,
                (
                    eid,
                    p.reference_no,
                    p.pdf_path,
                    org.get("nabh_org_id"),
                    p.nabh_name or org.get("nabh_name"),
                    p.accreditation_program or org.get("accreditation_program"),
                    p.valid_from,
                    p.valid_thru,
                    json.dumps(p.scope_items),
                    json.dumps(p.parsed_capabilities),
                    json.dumps(p.parsed_document) if p.parsed_document else None,
                    p.raw_text[:50000],
                    p.parse_method,
                    p.parse_confidence,
                ),
            )
    conn.commit()


def upsert_verifications(conn, rows: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO bronze.nabh_capability_verifications (
                    facility_id, capability, reference_no, nabh_org_id,
                    virtue_claimed, virtue_trust_signal, virtue_trust_score,
                    certificate_supports, certificate_scope_snippet,
                    nabh_match_method, nabh_match_confidence,
                    splink_match_probability, verification_score,
                    verification_signal, verified_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
                )
                ON CONFLICT (facility_id, capability, reference_no) DO UPDATE SET
                    nabh_org_id = EXCLUDED.nabh_org_id,
                    virtue_claimed = EXCLUDED.virtue_claimed,
                    virtue_trust_signal = EXCLUDED.virtue_trust_signal,
                    virtue_trust_score = EXCLUDED.virtue_trust_score,
                    certificate_supports = EXCLUDED.certificate_supports,
                    certificate_scope_snippet = EXCLUDED.certificate_scope_snippet,
                    nabh_match_method = EXCLUDED.nabh_match_method,
                    nabh_match_confidence = EXCLUDED.nabh_match_confidence,
                    splink_match_probability = EXCLUDED.splink_match_probability,
                    verification_score = EXCLUDED.verification_score,
                    verification_signal = EXCLUDED.verification_signal,
                    verified_at = NOW()
                """,
                (
                    r["facility_id"],
                    r["capability"],
                    r["reference_no"],
                    r.get("nabh_org_id"),
                    r.get("virtue_claimed"),
                    r.get("virtue_trust_signal"),
                    r.get("virtue_trust_score"),
                    r["certificate_supports"],
                    r.get("certificate_scope_snippet"),
                    r.get("nabh_match_method"),
                    r.get("nabh_match_confidence"),
                    r.get("splink_match_probability"),
                    r["verification_score"],
                    r["verification_signal"],
                ),
            )
    conn.commit()


def parse_certificates_local(paths: list[Path]) -> list[CertificateParse]:
    parses: list[CertificateParse] = []
    for path in paths:
        ref = reference_from_pdf(path)
        try:
            text = extract_pdf_local(path)
        except ValueError as exc:
            print(f"  skip {path.name}: {exc}", flush=True)
            continue
        parses.append(
            parse_certificate_text(
                text,
                reference_no=ref,
                pdf_path=path,
                parse_method="local_pypdf",
                parse_confidence=0.80,
            )
        )
    return parses


def parse_certificates_agent_bricks(
    paths: list[Path],
    *,
    profile: str | None,
    warehouse_id: str,
    volume_path: str,
    fallback_local: bool,
    skip_upload: bool = False,
) -> list[CertificateParse]:
    if skip_upload:
        print(
            f"Agent Bricks Document Parsing: using existing PDFs on {volume_path}…",
            flush=True,
        )
    else:
        print(
            f"Agent Bricks Document Parsing: uploading {len(paths)} PDF(s) → {volume_path}…",
            flush=True,
        )
        uploaded = upload_pdfs_to_volume(
            paths,
            volume_path,
            profile=profile,
            warehouse_id=warehouse_id,
        )
        print(f"  uploaded {uploaded} file(s).", flush=True)
    print("  running ai_parse_document + ai_extract…", flush=True)
    agent_rows = parse_via_agent_bricks(
        volume_path,
        profile=profile,
        warehouse_id=warehouse_id,
    )
    print(f"  parsed {len(agent_rows)} certificate(s) via Agent Bricks.", flush=True)

    parses: list[CertificateParse] = []
    for path in paths:
        ref = reference_from_pdf(path)
        row = agent_rows.get(ref)
        if row:
            parsed = certificate_parse_from_agent_bricks(ref, path, row)
            if parsed:
                parses.append(parsed)
                continue
        if not fallback_local:
            print(f"  skip {path.name}: Agent Bricks returned no content", flush=True)
            continue
        try:
            text = extract_pdf_local(path)
            parses.append(
                parse_certificate_text(
                    text,
                    reference_no=ref,
                    pdf_path=path,
                    parse_method="local_pypdf_fallback",
                    parse_confidence=0.70,
                )
            )
        except ValueError as exc:
            print(f"  skip {path.name}: {exc}", flush=True)
    return parses


def parse_certificates(
    paths: list[Path],
    *,
    mode: str,
    profile: str | None,
    warehouse_id: str,
    volume_path: str,
    fallback_local: bool,
    skip_upload: bool = False,
) -> list[CertificateParse]:
    if mode == "databricks":
        return parse_certificates_agent_bricks(
            paths,
            profile=profile,
            warehouse_id=warehouse_id,
            volume_path=volume_path,
            fallback_local=fallback_local,
            skip_upload=skip_upload,
        )
    return parse_certificates_local(paths)


def discover_pdfs(cert_dir: Path, *, limit: int | None) -> list[Path]:
    paths = sorted(cert_dir.glob("*.pdf"))
    if limit:
        paths = paths[:limit]
    return paths


def ensure_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(EXTRACTION_DDL)
        cur.execute(VERIFICATION_DDL)
        cur.execute(
            """
            ALTER TABLE bronze.nabh_certificate_extractions
            ADD COLUMN IF NOT EXISTS parsed_document jsonb
            """
        )
    conn.commit()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cert-dir",
        type=Path,
        default=DEFAULT_CERT_DIR,
        help="Directory of NABH certificate PDFs",
    )
    parser.add_argument("--limit", type=int, help="Cap PDFs processed (dev/test).")
    parser.add_argument(
        "--mode",
        choices=["local", "databricks"],
        default=os.getenv(
            "NABH_VERIFY_MODE",
            "databricks"
            if os.getenv("DATABRICKS_CONFIG_PROFILE") or os.getenv("DATABRICKS_HOST")
            else "local",
        ),
        help="databricks = Agent Bricks ai_parse_document + ai_extract (default when "
        "DATABRICKS_CONFIG_PROFILE is set); local = offline pypdf.",
    )
    parser.add_argument(
        "--profile",
        default=os.getenv("DATABRICKS_CONFIG_PROFILE"),
        help="Databricks CLI profile (default: DATABRICKS_CONFIG_PROFILE).",
    )
    parser.add_argument("--warehouse", default=DEFAULT_WAREHOUSE)
    parser.add_argument(
        "--volume-path",
        default=DEFAULT_VOLUME,
        help=f"UC volume for READ_FILES / ai_parse_document (default: {DEFAULT_VOLUME}).",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Skip uploading local PDFs (assume they already exist on the volume).",
    )
    parser.add_argument(
        "--fallback-local",
        action=argparse.BooleanOptionalAction,
        default=os.getenv("NABH_VERIFY_FALLBACK_LOCAL", "true").lower()
        not in ("0", "false", "no"),
        help="When Agent Bricks returns no content for a PDF, fall back to pypdf.",
    )
    parser.add_argument("--dsn", help="Postgres DSN override.")
    args = parser.parse_args(argv)

    if args.mode == "databricks" and not args.profile:
        parser.error(
            "--mode databricks requires a Databricks CLI profile "
            "(set DATABRICKS_CONFIG_PROFILE or pass --profile)."
        )

    paths = discover_pdfs(args.cert_dir, limit=args.limit)
    if not paths:
        print(f"No PDFs found in {args.cert_dir}")
        return 0

    dsn = args.dsn or db.database_url() or db.LOCAL_DEFAULT_DSN
    parses = parse_certificates(
        paths,
        mode=args.mode,
        profile=args.profile,
        warehouse_id=args.warehouse,
        volume_path=args.volume_path,
        fallback_local=args.fallback_local,
        skip_upload=args.no_upload,
    )

    with db.connect(dsn) as conn:
        ensure_schema(conn)
        nabh_orgs = load_nabh_orgs(conn)
        facility_links = load_facility_nabh_links(conn)
        virtue = load_virtue_assessments(conn)
        splink = load_splink_probs(conn)

        upsert_extractions(conn, parses, nabh_orgs)

        verification_rows: list[dict[str, Any]] = []
        linked = 0
        for p in parses:
            facility_id, match_conf, match_method, org_id = resolve_facility_for_cert(
                p,
                nabh_orgs=nabh_orgs,
                facility_links=facility_links,
                conn=conn,
            )
            if facility_id:
                linked += 1
            verification_rows.extend(
                build_verification_rows(
                    p,
                    facility_id=facility_id,
                    nabh_match_confidence=match_conf,
                    nabh_match_method=match_method,
                    nabh_org_id=org_id,
                    virtue=virtue,
                    splink=splink,
                )
            )

        upsert_verifications(conn, verification_rows)

    corroborated = sum(1 for r in verification_rows if r["verification_signal"] == "corroborated")
    contradicted = sum(1 for r in verification_rows if r["verification_signal"] == "contradicted")
    print(
        f"Verified {len(parses)} certificate(s) → {len(verification_rows)} facility×capability row(s) "
        f"({linked} facility link(s); {corroborated} corroborated, {contradicted} contradicted)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
