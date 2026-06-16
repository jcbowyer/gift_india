# Governance, Integrity, & Facility Trust (GIFT) Desk

> A Virtue Foundation hackathon project (**Track 1**) that
> answers one question: **can this facility actually do what it claims?**

Virtue Foundation maintains web-scraped, geotagged healthcare data describing
*where care actually lives today*. But a facility *listing* a capability — ICU,
maternity, emergency, oncology, trauma, NICU — is not the same as that capability
being **real**. The hard problem: **separate trustworthy capability claims from
unverified or contradicted ones**, with the evidence attached.

The Governance, Integrity, & Facility Trust (GIFT) Desk does exactly that. A planner picks a
**capability** and a **region**, and sees facilities ranked by how strongly their
claim is backed by evidence. Every facility carries a **trust signal** —
`strong`, `partial`, `weak / suspicious`, or `no claim` — *computed from the
citations behind it* (JCI Gold Seal accreditation, state registries, PMJAY
empanelment, the facility's own website, directories, news, patient reports,
inspections). The planner can expand any facility to read those citations and **override the
assessment with a reviewer note**.

## Evidence focus — JCI as the global gold standard

This repo focuses on **one authoritative accreditation signal** as the backbone of
the trust taxonomy:

### 1. The global "Gold Standard": JCI accreditation

The [Joint Commission International (JCI)](https://www.jointcommissioninternational.org/)
provides the most widely recognized international scoring system for hospital
capabilities.

- **Taxonomy use:** A facility holding the **Gold Seal of Approval** maps directly to
  the **`strong` evidence** signal for specific audited services — trauma, emergency
  care, ICU, and other capabilities covered by the accreditation scope.
- **Structure:** JCI's **8th Edition** standards are divided into five main sections,
  including **Patient-Centered Care** and **Healthcare Organization Management** —
  giving a structured, auditable basis for capability claims rather than self-reported
  website copy alone.

Other citations (state registries, PMJAY empanelment, facility websites, directories,
news, patient reports, inspections) still feed the trust engine; **JCI accreditation
is the primary authoritative corroboration** we optimize the desk around.

## What G.I.F.T. stands for

**Governance, Integrity, & Facility Trust** — the **Desk** is the planner-facing
surface that ranks facility capability claims by evidence.

**Why it works:** The name states the mission plainly and maps cleanly to the
Virtue Foundation hackathon brief.

**How to pitch it:**

> "NGO planners shouldn't have to fight 10,000 messy rows of web-scraped data to
> save lives. We built the Governance, Integrity, & Facility Trust (GIFT) Desk — a
> Databricks app that separates trustworthy capability claims from unverified ones,
> with the citations attached."

## Quick start

```bash
databricks auth login --profile gift-india --host https://dbc-0951416d-6d0e.cloud.databricks.com
./startup.sh
```

`startup.sh` checks Databricks auth, installs web deps on first run, and starts the
app at http://localhost:8000 (live Lakebase data). For manual steps see
[Quickstart](#quickstart); to deploy see [Publish to Lakebase](#publish-to-lakebase).

## The four hackathon tracks — we built Track 1

This repo focuses on **Track 1 — the Governance, Integrity, & Facility Trust (GIFT) Desk**.

| Track | Question | Status here |
|-------|----------|-------------|
| **1 · Governance, Integrity, & Facility Trust (GIFT) Desk** | Can this facility actually do what it claims? | ✅ **Built (this repo)** |
| 2 · Medical Desert Planner | Where are the highest-risk gaps in care? | — not built |
| 3 · Referral Copilot | Where should a patient or coordinator actually go? | — not built |
| 4 · Data Readiness Desk | What needs fixing before this dataset is trusted? | — not built |

**Track 1 minimum workflow — implemented end to end:** a planner selects a
**capability** and **region** → sees **ranked facilities** (by evidence strength)
→ **expands a facility to inspect its citations** → **overrides the assessment
with a note** (saved to *My Reviews*).

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

## Levels of the Indian government

India is a federal union, and its administrative geography nests as a hierarchy.
The Trust Desk's region picker and `gold.geography` table key on **states** and
**districts** — the two levels NGO planners actually allocate against — but the
full hierarchy is below for context:

| Level | Tier | Unit | Governing body |
|-------|------|------|----------------|
| 1 | **National (Union)** | Republic of India | Parliament + Union Government |
| 2 | **State / Union Territory** | 28 states, 8 UTs | State Legislature + Governor (states); LG/Administrator (UTs) |
| 3 | **District** | ~800 districts | District Collector / District Magistrate |
| 4 | **Sub-district** | Tehsil / Taluk / Block | Sub-Divisional / Block officers |
| — | **Local — Urban** | Municipal Corporation, Municipality, Nagar Panchayat | Elected urban local bodies (74th Amendment) |
| — | **Local — Rural** | Zila Parishad → Panchayat Samiti → Gram Panchayat | Panchayati Raj institutions (73rd Amendment) |

The first three levels correspond directly to the **Survey of India (SOI)**
boundary shapefiles used for GIS mapping:

| SOI shapefile | Admin level | Maps to |
|---------------|-------------|---------|
| India Boundary | Level 1 | National outline |
| India State Boundary | Level 2 | `state` in `gold.geography` |
| India District Boundary | Level 3 | `district` in `gold.geography` |

> SOI also publishes per-state and municipal-city boundary shapefiles. Source
> these from the [official Survey of India](https://surveyofindia.gov.in/) and
> respect its data-usage and copyright policies. The bundled
> `client/public/india-topo.json` is the district/state TopoJSON the map renders
> against; see project memory for its provenance and name-matching notes.

## Databricks workspaces & data source

The governed Virtue Foundation data lives on Databricks. Working workspaces:

| Workspace | Owner | Email | URL |
|-----------|-------|-------|-----|
| Mason Bushyeager's workspace | Mason Bushyeager| mbushyeager@carequest.org | https://dbc-0951416d-6d0e.cloud.databricks.com/explore/data/databricks_virtue_foundation_dataset_dais_2026?o=7474648526487231 |
 

**Additional contact:** kappasig@gmail.com

**Governed dataset:** `databricks_virtue_foundation_dataset_dais_2026` lives in
**John Bowyer's workspace** (shared via Delta Sharing) —
[open in Unity Catalog](https://dbc-0951416d-6d0e.cloud.databricks.com/explore/data/databricks_virtue_foundation_dataset_dais_2026?o=7474648526487231).

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
databricks auth login --profile gift-india --host https://dbc-0951416d-6d0e.cloud.databricks.com/

cd gift_india_web
npm install
npm run dev          # or, from the repo root: make web
```

`npm run dev` reads `gift_india_web/.env` (Databricks workspace + Lakebase endpoint)
and serves the app at the URL it prints (defaults to http://localhost:8000, and
falls back to the next free port). The Express server exposes `/api/*` routes
(`/api/capabilities`, `/api/regions`, `/api/facilities`, `/api/facilities/:id`,
`/api/overrides`, `/api/stats`) that read **gold serving tables only** on
Lakebase Postgres:

- `gold.facilities` / `gold.geography` — facility + district records
- `gold.facility_capability_assessments` — per-facility trust signals (built by dbt)
- `gold.capability_evidence` — citations quoting real facility-record fields

Planner overrides are stored in `app.capability_overrides`. **Run `make dbt`**
(after `make data` or publish) so the capability gold tables exist — the app
does not seed or fabricate data.

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

### Crawling facility websites into bronze

The governed dataset is **web-scraped**: `src/scraper.py` visits each facility's
official `website_url` and snapshots it under `data/scraped/` in a human-readable
hierarchy keyed by geography then facility —
`data/scraped/<state>/<district>/<facility-name>-<facility_id>/` (raw HTML +
extracted JSON, plus a top-level `manifest.json`). `src/load_crawl.py` then lands
those snapshots in the raw `bronze.facility_web_crawl` table — the replayable
input to the silver extraction step.

> 📍 **Coverage — full crawl data is limited to 5 pilot districts.** While the
> project is in pilot, the facility crawl is **scoped** (`CRAWL_REGIONS` in
> `src/scraper.py`) to:
>
> - **Mumbai City / Suburban** (Maharashtra) — dense coastal urban, high income
> - **New Delhi / Central Delhi** (Delhi NCT) — political hub, high income, inland
> - **Bengaluru Urban** (Karnataka) — tech-driven, South India, high growth
> - **Lucknow** (Uttar Pradesh) — large northern-plains district, medium-low income
> - **Jaisalmer** (Rajasthan) — vast desert/rural district, low density, arid
>
> Facilities outside these districts are skipped (≈1,100 of the ~8,400 facilities
> with a `website_url` are in scope). **More cities coming soon** — pass
> `--all-districts` (or `make crawl ALL=1`) to crawl the whole dataset.

> 🚫 **Excluded facility types — small primary-care / clinic records are skipped.**
> Deep analysis from scraping found that the bulk of the governed dataset is low-
> capability primary-care rows with little-to-no useful official web presence and
> no surgical role. Those types are excluded from the deep crawl **and** the
> downstream analysis regardless of district (`EXCLUDED_TYPES` in
> `src/scraper.py`), focusing the crawl on the ~6.5K hospital-grade facilities:
>
> | Excluded type | Rows (real VF dataset) |
> | --- | ---: |
> | `Clinic / Centre` | 3,481 |
> | `Primary Health Centre` | 12 |
> | `Community Health Centre` | 7 |
>
> Hospital-grade types are kept: `Private Hospital`, `Medical College Hospital`,
> `District Hospital`, `Charitable / Mission Hospital`. The match is
> case-insensitive on the facility `type`; edit `EXCLUDED_TYPES` to change it.

```bash
make crawl                       # scrape the pilot districts + land in bronze
make crawl ALL=1                 # scrape EVERY facility with a website_url (all districts)
make scrape LIMIT=20             # just scrape a sample (snapshots to data/scraped/)
make load-crawl                  # just land an existing data/scraped/ into bronze
make scrape INPUT=data/urls.csv  # scrape an ad-hoc URL list (website_url/url column, or .txt)
```

`load_crawl` appends idempotently — `crawl_id` is a hash of `website_url` +
`crawled_at`, so re-loading the same manifest inserts nothing, while a fresh
scrape appends new crawl history. It loads to Lakebase too
(`python -m src.load_crawl --target lakebase --endpoint … --profile …`).

> The synthetic demo facilities have an empty `website_url`, so `make scrape`
> finds nothing to fetch until you populate it from the governed Virtue
> Foundation dataset (or pass `INPUT=`).

### JCI accreditation as a trust signal (`data_source = jci`)

A second external source flags which facilities hold **JCI (Joint Commission
International)** accreditation. The official JCI directory is JS-rendered and
blocks bulk export (it 403s automated fetches), so — as the data-engineering
brief recommends — `src/jci_scraper.py` builds a **curated seed**
(`data/jci_india_seed.csv`) of India's JCI-accredited hospitals from medical-
tourism aggregators (Karetrip, Shifam Health, …), with a sample spot-checked
against the official portal
(`verified_on_portal`) and every row's `source` / `source_url` retained. It still
attempts the live directory (`--fetch-official`) and records the outcome in the
manifest. `src/load_jci.py` upserts the result into `bronze.jci_accreditations`
(`data_source = 'jci'`, idempotent on `jci_org_id`).

It also **snapshots each accredited hospital's official homepage** (the
`website_url` column of the seed) into the same human-readable hierarchy the
facility crawler uses —
`data/jci/scraped/<state>/<district>/<hospital-name>-<jci_org_id>/` (`page.html` +
`extracted.json`, plus a `manifest.json`) — and lands those snapshots in
`bronze.facility_web_crawl` so the JCI accreditation and its source page share one
raw-crawl table. Real hospital sites with bot protection (Apollo, BLK-Max, …)
return 403; those are recorded as failed crawls, the rest are captured.

```bash
make jci                         # seed + snapshot homepages + land BOTH in bronze
make jci-scrape                  # compile seed + snapshot homepages to data/jci/
make jci-scrape NO_PAGES=1       # seed only, no homepage snapshots (offline)
make load-jci                    # upsert data/jci/ into bronze.jci_accreditations
make load-jci-crawl              # land data/jci/scraped/ into bronze.facility_web_crawl
```

**Entity resolution** then turns those messy names ("Apollo Hospital, Chennai"
vs "Apollo Hospitals Enterprise Limited") into a `facility_id`: dbt normalizes
both the JCI org names and the governed facility names (`jci_normalize` macro) and
**inner-joins** them — tiered by specificity (exact name + state → brand + city →
brand + state, hospitals only) — into the gold reference table
`gold.facility_jci`. `gold.facilities` left-joins that crosswalk to flag
`jci_accredited` (confidence ≥ 0.70) and carry the resolved org name + provenance.
Against the real VF facility set this resolves 10 JCI organizations to their
governed `facility_id`s (AIG, Amrita, Continental, Medanta, Wockhardt, …).

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
  ENDPOINT=projects/gift_india/branches/production/endpoints/primary \
  PROFILE=<your-cli-profile>

# equivalently (logs in as the `admins` group, loads into the gift_india catalog):
cd gift_india_api && python -m src.load_db --target lakebase \
  --endpoint projects/gift_india/branches/production/endpoints/primary \
  --profile <your-cli-profile>
```

This lands the raw data in the `gift_india` catalog's `bronze` schema. Build the
`silver`/`gold` serving tables against Lakebase afterwards by pointing the dbt
profile at the endpoint — export `GIFT_INDIA_PGHOST` / `GIFT_INDIA_PGPASSWORD` /
`GIFT_INDIA_PGSSLMODE=require` from the same OAuth credential, set
`GIFT_INDIA_PGDATABASE=gift_india`, and set `GIFT_INDIA_PGUSER=admins` so the
`silver`/`gold` schemas are also owned by `admins`, then `make dbt`. The app
reads `gold`, so it isn't served until dbt has run.

Find the endpoint path with `databricks postgres list-endpoints projects/gift_india/branches/production`.
The bundle (`gift_india_web/databricks.yml` / `gift_india_web/app.yaml`) deploys the
web app with a Lakebase resource pointed at the `gift_india` database; the app's
service principal must be a member of the `admins` group to read the catalog.

## How it works

1. **Data** — `gift_india_api` loads facility + district records into `bronze`;
   `gift_india_dbt` promotes them to **`gold.facilities`** / **`gold.geography`**
   and builds Track 1 tables **`gold.facility_capability_assessments`** +
   **`gold.capability_evidence`** from structured facility fields (specialties,
   type, beds, `match_confidence`, `website_url`). Citations quote those columns —
   never fabricated prose.
2. **Trust engine** — dbt SQL derives each facility's per-capability **trust
   signal** and score from on-record evidence; low entity-match confidence flags
   weak/suspicious claims.
3. **Web app** (`gift_india_web`) — reads **`gold.*` only** (plus
   `app.capability_overrides` for human reviews). The Trust Desk ranks facilities,
   expands to show citations, and saves planner overrides.

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
│   ├── client/             # React frontend (Trust Desk, Facility detail, My Reviews)
│   ├── server/
│   │   ├── server.ts       # Express entry (AppKit + Lakebase plugins)
│   │   └── routes/gift_india/
│   │       ├── routes.ts       # /api/* Trust Desk routes (reads gold.* only)
│   │       └── capabilities.ts # capability catalog constants (matches dbt seed)
│   ├── databricks.yml      # bundle: deploys the app + Lakebase resource
│   ├── app.yaml            # Databricks App run command (npm run start)
│   └── package.json        # dev / build / start scripts
├── gift_india_dbt/         # dbt (POSTGRES) serving medallion — what the app reads
│   ├── models/silver/      # cleaned/typed facilities + geography (Lakebase bronze → silver)
│   ├── models/gold/        # facilities, geography, facility_capability_assessments, capability_evidence
│   ├── macros/             # haversine_km, geography_id, schema naming
│   └── seeds/              # state_codes + capabilities catalog
├── dbt_project/            # dbt (DATABRICKS) source medallion — DAB job on Databricks
│   ├── databricks.yml      # Databricks Asset Bundle (scheduled dbt Job)
│   └── models/             # VF Delta Share → bronze/silver/gold capability marts
├── gift_india_api/
│   └── src/
│       ├── data.py         # dataset generation + Postgres/Lakebase loaders
│       ├── db.py           # connectivity (local Postgres + Lakebase creds)
│       ├── load_db.py      # CLI: create schema + load facilities/districts (local | lakebase)
│       ├── scraper.py      # crawl facility website_url → data/scraped/ snapshots
│       ├── load_crawl.py   # CLI: land data/scraped/ into bronze.facility_web_crawl
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
