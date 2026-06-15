# gift_india India

> A Virtue Foundation hackathon project — a **navigator copilot** that recommends
> where to place visiting surgical teams across India to close the surgical-care gap.

An estimated **143 million people** lack timely access to safe surgery. Virtue
Foundation maintains geotagged healthcare data describing *where care actually
lives today*. The hard problem: **match the right surgical team to the right
location based on specialty and need.**

gift_india India turns that data into action. Describe a team in plain
language — _"3-surgeon cataract team, 5 days, willing to travel rural"_ — and the
copilot ranks the **medical deserts** where that team will help the most people.

## The four hackathon tracks

| Track | What it does | Status here |
|-------|--------------|-------------|
| **Virtual Copilot / Navigator** | Chatbot that recommends where to place a surgical team | ✅ Demo (this repo) |
| **Medical Desert Planner** | Map + analytics of underserved, high-population areas | ✅ Included (map tab) |
| **Data Readiness Desk** | Entity-resolution pipeline producing the ~10K-record dataset | ✅ Seeded by the synthetic generator |
| **(open)** | — | — |

## Why India

India was chosen deliberately: it is one of the most *challenging* countries for
this problem — huge population, enormous regional variation, and messy,
semi-structured source data. The underlying dataset is **web-scraped, structured
and semi-structured, then governed**: classic information extraction turns text
into rows and columns, attributes each row to a hospital, and resolves duplicate
entities into a single primary key with a **confidence score** (named-entity
resolution).

> For the hackathon demo the dataset is **synthetically generated** with realistic
> Indian districts, coordinates, populations and specialties, so the app runs with
> zero external dependencies. Swap `src/data.py` for the governed Virtue Foundation
> dataset (see below) to go live.

## Databricks workspaces & data source

The governed Virtue Foundation data lives on Databricks. Working workspaces:

| Workspace | Owner | Email | URL |
|-----------|-------|-------|-----|
| John Bowyer's workspace | John Bowyer | jbowyer@carequest.org | https://dbc-0be3157e-0574.cloud.databricks.com/ |
 

**Additional contact:** kappasig@gmail.com

**Governed dataset:** `databricks_virtue_foundation_dataset_dais_2026` lives in
**John Bowyer's workspace** (shared via Delta Sharing) —
[open in Unity Catalog](https://dbc-0be3157e-0574.cloud.databricks.com/explore/data/databricks_virtue_foundation_dataset_dais_2026?o=7474652488103392).

Schema `virtue_foundation_dataset` contains:

| Table | Description |
|-------|-------------|
| `facilities` | Geotagged healthcare facility records |
| `india_post_pincode_directory` | India Post pincode reference directory |
| `nfhs_5_district_health_indicators` | NFHS-5 district-level health indicators |

`src/data.py`'s `load_bundle()` reads from the best available source — Lakebase
when deployed, a local Postgres when configured, and the synthetic dataset
otherwise — so the engine, copilot, and UI never change.

## Quickstart (zero dependencies)

```bash
pip install -r requirements.txt
streamlit run app.py
```

Then open the local URL Streamlit prints (usually http://localhost:8501). With no
database configured, the app runs on the deterministic synthetic dataset.

## Local development with Postgres

For a more production-like loop, run a local Postgres that **mirrors the Lakebase
schema**, then point the app at it. This is the fast inner loop: edit, reload,
query real SQL — no Databricks round-trip.

```bash
cp .env.example .env          # sets GIFT_INDIA_DB_URL=postgresql://gift_india:gift_india@localhost:5432/gift_india

make db-up                    # start Postgres 17 (docker compose); creates the schema on first run
make load                     # generate + load the dataset (python -m src.load_db)
make run                      # streamlit run app.py  → now reads from local Postgres
```

`load_bundle()` auto-loads `.env`; once `GIFT_INDIA_DB_URL` is set the app reads the
`public.facilities` / `public.districts` tables (and falls back to the synthetic
dataset if the database is unreachable). `make db-reset` wipes and recreates the
volume; `make load FORCE=1` regenerates the dataset before loading.

> Don't have Docker? Point `GIFT_INDIA_DB_URL` at any Postgres and run
> `python -m src.load_db --dsn "$GIFT_INDIA_DB_URL"`.

## Publish to Lakebase

The **same loader** publishes the dataset to Databricks Lakebase, so the deployed
app reads the data you validated locally. It resolves the endpoint host and a
short-lived OAuth credential via the Databricks CLI.

```bash
make publish \
  ENDPOINT=projects/gift_india/branches/production/endpoints/<endpoint_id> \
  PROFILE=<your-cli-profile>

# equivalently:
python -m src.load_db --target lakebase \
  --endpoint projects/gift_india/branches/production/endpoints/<endpoint_id> \
  --profile <your-cli-profile>
```

Find the endpoint path with `databricks postgres list-endpoints projects/gift_india/branches/production`.
The bundle (`databricks.yml` / `app.yaml`) deploys the Streamlit app with a
Lakebase resource; deploy the app **before** loading so its service principal owns
the schema (see the Lakebase docs on schema ownership).

## How it works

1. **Data** (`src/data.py`) — generates/loads ~10K geotagged facility records and a
   district table (population, existing surgical capacity by specialty).
2. **Engine** (`src/matching.py`) — scores each district's *unmet need* for a
   specialty and ranks placement candidates by need × specialty gap × accessibility.
3. **Copilot** (`src/copilot.py`) — parses a natural-language team description into a
   structured query the engine can answer.
4. **UI** (`app.py`) — a Streamlit app with a chat-style copilot, a ranked
   recommendation list, and an interactive medical-desert map.

## Project layout

```
gift_india/
├── app.py              # Streamlit demo (copilot + map + planner)
├── requirements.txt
├── docker-compose.yml  # local Postgres for dev
├── Makefile            # db-up / load / run / publish shortcuts
├── .env.example        # GIFT_INDIA_DB_URL for local dev
├── databricks.yml      # bundle: deploys the app + Lakebase resource
├── app.yaml            # Databricks App run command
├── db/
│   └── schema.sql      # serving schema (local Postgres + Lakebase)
├── src/
│   ├── data.py         # dataset generation + Postgres/Lakebase loaders
│   ├── db.py           # connectivity (local Postgres + Lakebase creds)
│   ├── load_db.py      # CLI: create schema + load (local | lakebase)
│   ├── matching.py     # recommendation engine
│   └── copilot.py      # natural-language request parsing
├── docs/architecture/  # medallion + metric-store design
└── data/               # generated CSVs (gitignored)
```
