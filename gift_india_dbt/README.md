# gift_india_dbt (Postgres) — serving dbt medallion

> **This is one of two dbt projects.** This one (`gift_india_dbt/`, dbt project
> name `gift_india_postgres`, adapter **postgres**) is the **serving** medallion
> the web app reads (`gold.facilities` / `gold.geography`). The sibling
> [`../dbt_project/`](../dbt_project) (project name `gift_india_databricks`,
> adapter **databricks**) is the **upstream** lakehouse medallion. They are a
> pipeline — Databricks gold is synced to Lakebase, then this project serves it —
> **not duplicates**. See the [repo README](../README.md) for the full architecture.

dbt (Postgres adapter) implementation of the `bronze → silver → gold` medallion
described in [`docs/architecture/medallion-and-metric-store.md`](../docs/architecture/medallion-and-metric-store.md).
It transforms the raw facility + district records the Python loader lands into
clean **silver** models and the two **gold** serving models you'll build on:
`gold.facilities` and `gold.geography`, **linked by lat/longitude**.

## Layers

| Layer | Schema | Models |
|-------|--------|--------|
| bronze | `bronze` (where `load_db.py` writes) | sources: `facilities_virtue`, `districts` |
| silver | `silver` | `silver_facilities`, `silver_geography` — cleaned, typed, `state_code` attached, coordinates validated, duplicates resolved |
| gold | `gold` | `facilities`, `geography` — serving tables with enforced PK/FK constraints |

### gold.geography
One row per district (within a state), keyed by `geography_id`
(`<state_code>-<district-slug>`, e.g. `mh-mumbai`). Carries the centroid
`lat`/`lon`, NFHS-5 indicators, and rolled-up `facility_count` /
`surgical_facility_count` / `annual_surgeries_total`.

### gold.facilities
One row per facility, with its own `lat`/`lon`, a `geography_id` **foreign key**
to `gold.geography`, and `distance_from_centroid_km` — the great-circle distance
from the facility's coordinates to its geography centroid, computed in SQL via
the `haversine_km` macro. That distance is the explicit **lat/longitude link**
between a facility and its geography.

## Run it

```bash
# 1. Warehouse up + raw data loaded (from the repo root)
make db-up && make load

# 2. dbt toolchain
python -m venv .venv && . .venv/bin/activate   # or your existing venv
pip install -r gift_india_dbt/requirements.txt

# 3. Build everything (seeds + models + tests)
make dbt          # = cd gift_india_dbt && DBT_PROFILES_DIR=. dbt build
make dbt-test     # tests only
```

The profile (`profiles.yml` in this dir) defaults to the local docker-compose
Postgres. Point it elsewhere (e.g. Lakebase) by exporting `GIFT_INDIA_PGHOST`,
`GIFT_INDIA_PGPORT`, `GIFT_INDIA_PGUSER`, `GIFT_INDIA_PGPASSWORD`,
`GIFT_INDIA_PGDATABASE`, and `GIFT_INDIA_PGSSLMODE`.

## Conventions

- **Naming:** both `state` (full name) and `state_code` (2-letter, from the
  `state_codes` seed) are carried through. No `dim_`/`fact_` names.
- **Keys:** gold models declare an explicit primary key, and `gold.facilities`
  declares a foreign key to `gold.geography` — enforced in Postgres via dbt
  model contracts (`contract: enforced`).
- **Transforms in SQL only** — Python is for ingestion/loading, never SQL logic.
