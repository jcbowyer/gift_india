# gift_india India

> A Virtue Foundation hackathon project — a **navigator copilot** that recommends
> where to place visiting surgical teams across India to close the surgical-care gap.

An estimated **143 million people** lack timely access to safe surgery. Virtue
Foundation maintains geotagged healthcare data describing *where care actually
lives today*. The hard problem: **match the right surgical team to the right
location based on specialty and need.**

GIFT India turns that data into action. Describe a team in plain
language — _"3-surgeon cataract team, 5 days, willing to travel rural"_ — and the
copilot ranks the **medical deserts** where that team will help the most people.

## What G.I.F.T. stands for

**Gold Insights & Facility Templates for India.**

**Why it works:** It is punchy, impossible to forget, and captures the exact spirit
of a "Hackathon for Good."

**How to pitch it:**

> "NGO planners shouldn't have to fight 10,000 messy rows of web-scraped data to
> save lives. We built G.I.F.T. India—a Databricks app that delivers Gold-standard
> Insights and verified Facility Templates to map healthcare across India."

## Quick start

```bash
databricks auth login --profile gift-india --host https://dbc-0be3157e-0574.cloud.databricks.com
./startup.sh
```

`startup.sh` checks Databricks auth, installs web deps on first run, and starts the
app at http://localhost:8000 (live Lakebase data). For manual steps see
[Quickstart](#quickstart); to deploy see [Publish to Lakebase](#publish-to-lakebase).

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

## Quickstart

The app is a **Databricks AppKit app**: a React client + Express server
(`gift_india_web`) that reads live data from **Lakebase Postgres**. The Python data
loaders/engine live in `gift_india_api`.

First authenticate to the Databricks workspace, then run the dev server:

```bash
databricks auth login --profile gift-india --host https://dbc-0be3157e-0574.cloud.databricks.com

cd gift_india_web
npm install
npm run dev          # or, from the repo root: make web
```

`npm run dev` reads `gift_india_web/.env` (Databricks workspace + Lakebase endpoint)
and serves the app at the URL it prints (defaults to http://localhost:8000, and
falls back to the next free port). The Express server exposes `/api/*` routes
(`/api/stats`, `/api/specialties`, `/api/districts`, `/api/recommend`, `/api/plans`)
that query the **gold serving tables** (`gold.facilities` / `gold.geography`) in
Lakebase. Serving reads gold only — the raw landing tables live in `bronze`, and
`public` is left to the managed Postgres / Lakebase (Neon) system objects.

## Data loaders & local Postgres

The dataset is generated and loaded by the Python loaders in `gift_india_api/src`.
For a production-like data loop, run a local Postgres that **mirrors the Lakebase
medallion**, land the raw dataset in `bronze`, build `silver` + `gold` with dbt,
validate it, then publish to Lakebase.

```bash
cp .env.example .env          # sets GIFT_INDIA_DB_URL=postgresql://gift_india:gift_india@localhost:5432/gift_india

make db-up                    # start Postgres 17 (docker compose); creates the bronze schema on first run
make data                     # land raw in bronze (make load) + build silver/gold (make dbt)
```

`make load` lands the raw dataset in `bronze`; `make dbt` promotes it through
`silver` to the `gold` serving tables the app reads. `make data` runs both.
`make db-reset` wipes and recreates the volume; `make load FORCE=1` regenerates
the dataset before loading.

> Don't have Docker? Point `GIFT_INDIA_DB_URL` at any Postgres and run
> `cd gift_india_api && python -m src.load_db --dsn "$GIFT_INDIA_DB_URL"`, then
> `make dbt` to build the silver/gold layers.

## Publish to Lakebase

The **same loader** publishes the dataset to Databricks Lakebase, so the deployed
app reads the data you validated locally. It resolves the endpoint host and a
short-lived OAuth credential via the Databricks CLI.

All data lives in the **`gift_india` catalog** (Lakebase database), and the
catalog, the `bronze` schema, and every table are owned by the shared **`admins`
group role**. The loader achieves this by **logging in as the `admins` group**:
any member of the Databricks `admins` group authenticates with the group role
name as the username and their own OAuth token as the password, so everything it
creates is owned by `admins` directly (see the Lakebase docs on
[Postgres group roles](https://docs.databricks.com/aws/en/oltp/projects/postgres-roles)
and [object ownership](https://docs.databricks.com/aws/en/oltp/projects/transfer-object-ownership)).

```bash
make publish \
  ENDPOINT=projects/carenavigator/branches/production/endpoints/primary \
  PROFILE=<your-cli-profile>

# equivalently (logs in as the `admins` group, loads into the gift_india catalog):
cd gift_india_api && python -m src.load_db --target lakebase \
  --endpoint projects/carenavigator/branches/production/endpoints/primary \
  --profile <your-cli-profile>
```

This lands the raw data in the `gift_india` catalog's `bronze` schema. Build the
`silver`/`gold` serving tables against Lakebase afterwards by pointing the dbt
profile at the endpoint — export `GIFT_INDIA_PGHOST` / `GIFT_INDIA_PGPASSWORD` /
`GIFT_INDIA_PGSSLMODE=require` from the same OAuth credential, set
`GIFT_INDIA_PGDATABASE=gift_india`, and set `GIFT_INDIA_PGUSER=admins` so the
`silver`/`gold` schemas are also owned by `admins`, then `make dbt`. The app
reads `gold`, so it isn't served until dbt has run.

Find the endpoint path with `databricks postgres list-endpoints projects/carenavigator/branches/production`.
The bundle (`gift_india_web/databricks.yml` / `gift_india_web/app.yaml`) deploys the
web app with a Lakebase resource pointed at the `gift_india` database; the app's
service principal must be a member of the `admins` group to read the catalog.

## How it works

1. **Data** (`gift_india_api/src/data.py`) — generates/loads ~10K geotagged facility
   records and a district table (population, existing surgical capacity by specialty);
   `load_db.py` loads them into local Postgres / Lakebase.
2. **Engine** — the web server (`gift_india_web/server/routes/gift_india/routes.ts`)
   scores each district's *unmet need* for a specialty directly in SQL over the gold
   serving tables (`gold.geography` / `gold.facilities`), ranking candidates by
   need × specialty gap × reach × accessibility.
3. **Web app** (`gift_india_web`) — a Databricks AppKit app (React client + Express
   server) with a navigator copilot, a ranked recommendation list, an interactive
   medical-desert map, and saved placement plans, reading live data from Lakebase.

## Two dbt projects (different warehouses, not duplicates)

Transformation happens in **two distinct dbt projects that run on different
engines** — this is intentional, not redundancy:

| Project | Adapter | Runs on | Builds | Consumer |
|---------|---------|---------|--------|----------|
| `dbt_project/` | `databricks` | Databricks (DAB Job) | `workspace.gift_india_{bronze,silver,gold}` capability/metric marts from the governed Virtue Foundation Delta Share | Databricks analytics |
| `gift_india_dbt/` | `postgres` | Lakebase / local Postgres | `silver` + `gold.facilities` / `gold.geography` (lat/long-linked serving tables) from the Postgres `bronze` landing | The web app + `data.py` |

Because they target different warehouses (and even different schema names —
`gift_india_silver` on Databricks vs `silver` on Postgres) they never collide.
The **app's serving layer is `gift_india_dbt`** (`gold.facilities` /
`gold.geography`); `dbt_project` is the upstream Databricks medallion.

Build them from the repo root:

```bash
make data            # Postgres serving medallion (load bronze + build silver/gold)
make dbt-databricks  # Databricks medallion (dbt_project/ on the SQL warehouse)
make pipeline        # both of the above
```

## Project layout

```
gift_india/
├── gift_india_web/         # Databricks AppKit app (React client + Express server)
│   ├── client/             # React frontend (Navigator, Map, Plans pages)
│   ├── server/
│   │   ├── server.ts       # Express entry (AppKit + Lakebase plugins)
│   │   └── routes/gift_india/routes.ts  # /api/* routes + SQL scoring engine
│   ├── databricks.yml      # bundle: deploys the app + Lakebase resource
│   ├── app.yaml            # Databricks App run command (npm run start)
│   └── package.json        # dev / build / start scripts
├── gift_india_dbt/         # dbt (POSTGRES) serving medallion — what the app reads
│   ├── models/silver/      # cleaned/typed facilities + geography (Lakebase bronze → silver)
│   ├── models/gold/        # serving: gold.facilities + gold.geography linked by lat/lon
│   ├── macros/             # haversine_km, geography_id, schema naming
│   └── seeds/              # state → state_code lookup
├── dbt_project/            # dbt (DATABRICKS) source medallion — DAB job on Databricks
│   ├── databricks.yml      # Databricks Asset Bundle (scheduled dbt Job)
│   └── models/             # VF Delta Share → bronze/silver/gold capability marts
├── gift_india_api/
│   └── src/
│       ├── data.py         # dataset generation + Postgres/Lakebase loaders
│       ├── db.py           # connectivity (local Postgres + Lakebase creds)
│       ├── load_db.py      # CLI: create schema + load (local | lakebase)
│       ├── matching.py     # legacy scoring engine (now done in SQL by the web app)
│       └── copilot.py      # natural-language request parsing
├── requirements.txt        # Python deps for the gift_india_api loaders
├── docker-compose.yml      # local Postgres for dev
├── Makefile                # db-up / load / web / publish shortcuts
├── .env.example            # GIFT_INDIA_DB_URL for local dev
├── db/
│   └── schema.sql          # bronze landing schema (raw tables the loader writes)
├── docs/architecture/      # medallion + metric-store design
└── data/                   # generated CSVs (gitignored)
```
