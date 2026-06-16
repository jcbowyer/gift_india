"""Download Survey of India (SOI) shapefiles and land their flat attributes in bronze.

Source: SimplyGIS — "Download SOI Shapefile of India States and Districts"
https://simplygis.in/2025/07/26/download-soi-shapefile-of-india-states-and-districts/

Four reference layers are mirrored from SimplyGIS' Google Drive into
``data/simplygis/<layer>/`` (the canonical store) and their **flat shapefile
information** — the ``.dbf`` attribute table, one row per feature — is ingested
into ``bronze.soi_shapefile_features``. We do not reproject or store geometry:
each feature keeps its verbatim attributes (JSONB), its bounding box, and the
layer's CRS WKT (read from the sibling ``.prj``) so units are self-describing.

Note the India layers are projected in **Lambert Conformal Conic (metres)**, so
their bbox values are projected metres, not lon/lat; ``world_countries`` is in
WGS84 degrees. The ``crs_wkt`` column records which is which per layer.

Like ``src.load_db`` this targets local Postgres or Databricks Lakebase, and the
load is **idempotent**: each layer is fully refreshed (delete-then-insert keyed
by ``layer``), and ``(layer, feature_index)`` is unique.

Examples
--------
Ingest the already-downloaded shapefiles into local Postgres::

    python -m src.load_shapefiles

Download fresh copies from SimplyGIS first, then ingest::

    python -m src.load_shapefiles --download

Publish to Lakebase (resolves host + OAuth token via the Databricks CLI)::

    python -m src.load_shapefiles --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

import shapefile  # pyshp — pure-Python shapefile reader
from loguru import logger

from . import db
from .load_db import DEFAULT_OWNER, _lakebase_dsn

# Canonical store for the SimplyGIS shapefiles (relative to the repo root).
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = _PROJECT_ROOT / "data" / "simplygis"

_SOURCE_PAGE = (
    "https://simplygis.in/2025/07/26/"
    "download-soi-shapefile-of-india-states-and-districts/"
)


@dataclass(frozen=True)
class ShapeLayer:
    """One SimplyGIS shapefile layer: where it lives and where it came from."""

    name: str          # logical layer name + subfolder under data/simplygis/
    base: str          # shapefile basename (without extension)
    drive_id: str      # Google Drive file id of the source zip
    source_page: str   # SimplyGIS page documenting the layer

    @property
    def subdir(self) -> str:
        return self.name


LAYERS: dict[str, ShapeLayer] = {
    layer.name: layer
    for layer in (
        ShapeLayer(
            "india_states", "India_State_Boundary",
            "1u56td5Dsjgc4AdQIU-7RVWDuOvJ_s6K4",
            "https://simplygis.in/2026/04/13/download-soi-india-state-boundary-shapefile/",
        ),
        ShapeLayer(
            "india_districts", "India_District_Boundary",
            "1CUAlJO45Ak-WEmbpaBiSFYDWmMGtcrws",
            "https://simplygis.in/2026/04/13/download-soi-india-district-boundary-shapefiles/",
        ),
        ShapeLayer(
            "india_boundary", "India_Outline",
            "1m5Rl7qOc2pKqSXPv3eu9KMiq8Z5FO8m_",
            "https://simplygis.in/2026/04/13/download-soi-india-boundary-shapefile/",
        ),
        ShapeLayer(
            "world_countries", "Worldmap",
            "1XXW1bSzaHeZaIqZfWi1n5lT0hEMx6o1Q",
            "https://simplygis.in/2023/12/21/world-countries-shapefile-india-corrected/",
        ),
    )
}

_TABLE = "soi_shapefile_features"

_TABLE_SQL = """
CREATE SCHEMA IF NOT EXISTS {schema};
CREATE TABLE IF NOT EXISTS {schema}.{table} (
    id            bigserial   PRIMARY KEY,
    layer         text        NOT NULL,
    feature_index integer     NOT NULL,
    attributes    jsonb       NOT NULL,
    shape_type    text,
    min_x         double precision,
    min_y         double precision,
    max_x         double precision,
    max_y         double precision,
    n_parts       integer,
    n_points      integer,
    crs_wkt       text,
    source_url    text,
    source_file   text,
    loaded_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (layer, feature_index)
);
CREATE INDEX IF NOT EXISTS {table}_layer_idx ON {schema}.{table} (layer);
CREATE INDEX IF NOT EXISTS {table}_attrs_gin ON {schema}.{table} USING gin (attributes);
"""

_INSERT_COLS = [
    "layer", "feature_index", "attributes", "shape_type",
    "min_x", "min_y", "max_x", "max_y", "n_parts", "n_points",
    "crs_wkt", "source_url", "source_file",
]


# --------------------------------------------------------------- download
def _download_drive(file_id: str, dest: Path) -> None:
    """Download a (possibly large) Google Drive file, handling the scan token."""
    import requests

    url = "https://drive.google.com/uc?export=download"
    with requests.Session() as session:
        resp = session.get(url, params={"id": file_id}, stream=True, timeout=120)
        # Large files return an HTML interstitial with a confirm token first.
        token = next(
            (v for k, v in resp.cookies.items() if k.startswith("download_warning")),
            None,
        )
        if token is None and b"confirm=" in resp.content[:4096]:
            token = "t"
        if token:
            resp = session.get(
                url, params={"id": file_id, "confirm": token}, stream=True, timeout=300
            )
        resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                if chunk:
                    fh.write(chunk)


def ensure_layer_files(layer: ShapeLayer, data_dir: Path, download: bool) -> Path:
    """Return the shapefile basename path for ``layer``, downloading if asked.

    Files are stored under ``<data_dir>/<layer>/<base>.{shp,shx,dbf,prj,...}``.
    """
    folder = data_dir / layer.subdir
    base = folder / layer.base
    if base.with_suffix(".shp").exists() and not download:
        return base

    if download or not base.with_suffix(".shp").exists():
        zip_path = folder / f"{layer.name}.zip"
        if download or not zip_path.exists():
            logger.info("Downloading {} from Google Drive ({})…", layer.name, layer.drive_id)
            _download_drive(layer.drive_id, zip_path)
        logger.info("Extracting {} → {}", zip_path.name, folder)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(folder)

    if not base.with_suffix(".shp").exists():
        raise FileNotFoundError(
            f"{base.with_suffix('.shp')} not found after preparing {layer.name}. "
            f"Re-run with --download, or place the shapefile under {folder}. "
            f"Source: {layer.source_page}"
        )
    return base


# --------------------------------------------------------------- read
def _read_prj(base: Path) -> str | None:
    prj = base.with_suffix(".prj")
    return prj.read_text(encoding="utf-8").strip() if prj.exists() else None


def feature_rows(layer: ShapeLayer, base: Path) -> list[tuple]:
    """Build ``bronze.soi_shapefile_features`` rows from a shapefile's flat table."""
    crs_wkt = _read_prj(base)
    source_file = str(base.with_suffix(".shp").relative_to(_PROJECT_ROOT))
    rows: list[tuple] = []
    with shapefile.Reader(str(base)) as reader:
        field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        shape_type = reader.shapeTypeName
        for i, sr in enumerate(reader.iterShapeRecords()):
            attrs = {
                name: _jsonable(value)
                for name, value in zip(field_names, list(sr.record))
            }
            shape = sr.shape
            bbox = getattr(shape, "bbox", None)  # (min_x, min_y, max_x, max_y)
            points = getattr(shape, "points", []) or []
            parts = getattr(shape, "parts", []) or []
            rows.append(
                (
                    layer.name,
                    i,
                    json.dumps(attrs, ensure_ascii=False),
                    shape_type,
                    *(bbox if bbox else (None, None, None, None)),
                    len(parts) if parts else (1 if points else 0),
                    len(points),
                    crs_wkt,
                    layer.source_page,
                    source_file,
                )
            )
    return rows


def _jsonable(value):
    """Normalise a dbf field value to a JSON-serialisable scalar."""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace").strip()
    if isinstance(value, str):
        return value.strip()
    # dates / Decimal etc. fall back to str so the JSONB load never fails.
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return str(value)


# --------------------------------------------------------------- load
def _ensure_table(conn, schema: str) -> None:
    with conn.cursor() as cur:
        cur.execute(_TABLE_SQL.format(schema=schema, table=_TABLE))
    conn.commit()


def _load_layer(conn, schema: str, rows: list[tuple]) -> int:
    if not rows:
        return 0
    layer_name = rows[0][0]
    cols = ", ".join(_INSERT_COLS)
    placeholders = ", ".join(["%s"] * len(_INSERT_COLS))
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {schema}.{_TABLE} WHERE layer = %s", (layer_name,))
        cur.executemany(
            f"INSERT INTO {schema}.{_TABLE} ({cols}) VALUES ({placeholders})", rows
        )
    conn.commit()
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir", type=Path, default=DEFAULT_DATA_DIR,
        help=f"Where the shapefiles live (default: {DEFAULT_DATA_DIR}).",
    )
    parser.add_argument(
        "--download", action="store_true",
        help="(Re)download the shapefile zips from SimplyGIS/Google Drive first.",
    )
    parser.add_argument(
        "--layers", nargs="*", choices=list(LAYERS), default=list(LAYERS),
        help="Subset of layers to process (default: all).",
    )
    parser.add_argument(
        "--target", choices=["local", "lakebase"], default="local",
        help="Where to land the rows (default: local).",
    )
    parser.add_argument("--dsn", help="Explicit Postgres DSN (local target).")
    parser.add_argument(
        "--endpoint",
        help="Lakebase endpoint resource path (required for --target lakebase).",
    )
    parser.add_argument("--profile", help="Databricks CLI profile.")
    parser.add_argument(
        "--owner", default=DEFAULT_OWNER,
        help=f"Lakebase group role to log in as (default: {DEFAULT_OWNER}).",
    )
    parser.add_argument(
        "--user", help="Override the Lakebase login role (defaults to --owner)."
    )
    parser.add_argument(
        "--database", default="gift_india",
        help="Lakebase database / catalog name (default: gift_india).",
    )
    parser.add_argument("--schema", default=db.DEFAULT_SCHEMA)
    args = parser.parse_args(argv)

    if args.target == "lakebase":
        if not args.endpoint:
            parser.error("--endpoint is required for --target lakebase")
        dsn = _lakebase_dsn(args)
        where = f"Lakebase ({args.endpoint})"
    else:
        dsn = args.dsn or db.database_url() or db.LOCAL_DEFAULT_DSN
        where = "local Postgres"

    logger.info("Connecting to {}…", where)
    total = 0
    with db.connect(dsn) as conn:
        _ensure_table(conn, args.schema)
        for name in args.layers:
            layer = LAYERS[name]
            base = ensure_layer_files(layer, args.data_dir, args.download)
            rows = feature_rows(layer, base)
            loaded = _load_layer(conn, args.schema, rows)
            total += loaded
            logger.success(
                "Landed {} feature(s) for layer '{}' into {}.{}.",
                loaded, name, args.schema, _TABLE,
            )

    logger.success(
        "Done — {} SOI feature(s) across {} layer(s) in {}.{} on {}.",
        total, len(args.layers), args.schema, _TABLE, where,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
