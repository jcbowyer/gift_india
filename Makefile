# Governance, Integrity, & Facility Trust (GIFT) Gauge — common dev tasks.
#
#   make db-up      start local Postgres (docker compose)
#   make load           generate + land the raw dataset into the bronze schema
#   make data           Postgres serving loop: load (bronze) + dbt build (silver/gold)
#   make dbt-databricks  build the upstream Databricks medallion (dbt_project/)
#   make pipeline        build BOTH medallions (Databricks marts + Postgres serving)
#   make db-down        stop local Postgres (keeps data)
#   make db-reset       stop + wipe the data volume, then start fresh
#   make web            run the gift_india_web app locally (npm run dev)
#   make crawl          scrape facility websites + land them in bronze
#   make test           run the gift_india_api Python unit tests (pytest)
#   make publish        publish the dataset to Lakebase (set ENDPOINT, PROFILE)

.PHONY: db-up db-down db-reset load load-real data pipeline web scrape load-crawl crawl jci-scrape load-jci load-jci-crawl jci nabh-scrape load-nabh nabh nhpr-scrape load-nhpr nhpr pmjay-scrape load-pmjay pmjay med-travel shapefiles test publish dbt dbt-test dbt-docs dbt-databricks narrate-evidence narrate-pilot narrate-pilot-stub pg-check

# Load repo .env (+ optional .env.local) and sync GIFT_INDIA_PG* from GIFT_INDIA_DB_URL.
define LOAD_GIFT_ENV
eval "$$(cd gift_india_api && $(PYTHON) -m src.pg_env --export)"
endef

# Prefer the repo venv when present; fall back to python3 on PATH.
# Use $(CURDIR) so the interpreter still resolves after `cd gift_india_api`.
PYTHON := $(if $(wildcard $(CURDIR)/.venv/bin/python),$(CURDIR)/.venv/bin/python,python3)

# Docker Compose v2 plugin (`docker compose`) or standalone v1 (`docker-compose`).
ifneq (,$(shell docker compose version >/dev/null 2>&1 && echo ok))
  COMPOSE := docker compose
else ifneq (,$(shell command -v docker-compose >/dev/null 2>&1 && echo ok))
  COMPOSE := docker-compose
else
  COMPOSE :=
endif

db-up:
ifeq ($(COMPOSE),)
	@echo "ERROR: Docker Compose is not installed." >&2
	@echo "  sudo apt install docker-compose-v2    # recommended (Compose plugin)" >&2
	@echo "  sudo apt install docker-compose         # legacy standalone binary" >&2
	@exit 1
endif
	$(COMPOSE) up -d
	@echo "Postgres is starting on localhost:5433 (db: gift_india)."

db-down:
ifeq ($(COMPOSE),)
	@echo "ERROR: Docker Compose is not installed (see \`make db-up\` for install hint)." >&2
	@exit 1
endif
	$(COMPOSE) down

db-reset:
ifeq ($(COMPOSE),)
	@echo "ERROR: Docker Compose is not installed (see \`make db-up\` for install hint)." >&2
	@exit 1
endif
	$(COMPOSE) down -v
	$(COMPOSE) up -d

# Data loaders live in gift_india_api/src and use package-relative imports.
# Lands the raw dataset in the `bronze` schema (db/schema.sql); dbt promotes it.
load:
	cd gift_india_api && $(PYTHON) -m src.load_db $(if $(FORCE),--force,)

# Full local data loop: land raw in bronze, then build silver + gold via dbt so
# the app (which reads gold) has serving tables. Needs the dbt toolchain
# (pip install -r gift_india_dbt/requirements.txt) and a running warehouse.
data: load dbt

# --- REAL governed Virtue Foundation data (fast path, no bronze/dbt rebuild) ---
# Export the four gold.* serving tables straight from the VF Delta Share into
# data/virtue/*.csv. Needs the Databricks CLI authenticated; override the
# read source via PROFILE / WAREHOUSE.
export-virtue:
	PROFILE=$(or $(PROFILE),gift-india-mb) WAREHOUSE=$(or $(WAREHOUSE),234ccf680e359443) python data/export_virtue.py

# Land the REAL VF rows (data/virtue/*.csv) into bronze.* so the dbt medallion
# (silver/gold + JCI entity resolution) runs on real names instead of the
# synthetic demo set. Follow with `make dbt`. Use this instead of `make load`
# when you want real data through the medallion.
#   make load-real && make dbt
load-real:
	cd gift_india_api && $(PYTHON) -m src.load_bronze_real \
		$(if $(filter lakebase,$(TARGET)),--target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),),)

# Load data/virtue/*.csv into the gold.* schema the app reads.
#   local:    make load-virtue
#   lakebase: make load-virtue TARGET=lakebase ENDPOINT=projects/.../endpoints/primary PROFILE=<profile>
load-virtue:
	cd gift_india_api && $(PYTHON) -m src.load_virtue \
		$(if $(filter lakebase,$(TARGET)),--target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),),)

# Run the web app (React client + Express server) in dev mode.
web:
	cd gift_india_web && npm run dev

# Scrape facility official websites into data/scraped/.
# Scoped to the pilot districts by default (CRAWL_REGIONS in src/scraper.py);
# pass ALL=1 to crawl every facility with a website_url.
# Usage: make scrape [INPUT=data/facility_urls.csv] [LIMIT=20] [ALL=1]
scrape:
	cd gift_india_api && $(PYTHON) -m src.scraper $(if $(INPUT),--input $(INPUT),) $(if $(LIMIT),--limit $(LIMIT),) $(if $(ALL),--all-districts,)

# Land the scraped snapshots into bronze.facility_web_crawl (append, idempotent).
# Usage: make load-crawl [SOURCE=data/scraped]
load-crawl:
	cd gift_india_api && $(PYTHON) -m src.load_crawl $(if $(SOURCE),--source $(SOURCE),)

# Scrape the official websites AND land them in bronze in one step.
# Scoped to the pilot districts by default; pass ALL=1 to crawl everywhere.
# Usage: make crawl [INPUT=data/facility_urls.csv] [LIMIT=20] [ALL=1]
crawl: scrape load-crawl

# Compile the JCI seed for India into data/jci/ AND snapshot each hospital's
# official homepage under data/jci/scraped/<state>/<district>/<name>-<id>/.
# Pass NO_PAGES=1 to skip the homepage snapshots (offline/deterministic), or
# FETCH_OFFICIAL=1 to also try the live (usually bot-blocked) JCI directory.
jci-scrape:
	cd gift_india_api && $(PYTHON) -m src.jci_scraper \
		$(if $(NO_PAGES),,--scrape-pages) \
		$(if $(FETCH_OFFICIAL),--fetch-official,) \
		$(if $(LIMIT),--limit $(LIMIT),)

# Land the JCI seed into bronze.facilities_jci (upsert, idempotent).
load-jci:
	cd gift_india_api && $(PYTHON) -m src.load_jci $(if $(SOURCE),--source $(SOURCE),)

# Land the scraped JCI homepage snapshots into bronze.facility_web_crawl (the same
# raw-crawl table the facility crawler uses; append, idempotent).
load-jci-crawl:
	cd gift_india_api && $(PYTHON) -m src.load_crawl --source ../data/jci/scraped

# Compile the JCI seed + snapshot homepages, then land BOTH the accreditation rows
# (bronze.facilities_jci) and the page snapshots (bronze.facility_web_crawl).
# dbt then resolves orgs to facility_ids (gold.facility_jci) and flags
# gold.facilities.jci_accredited.
jci: jci-scrape load-jci load-jci-crawl

# Scrape the full NABH accredited-organisation directory (nabh.co, ~19k orgs) into
# data/nabh/nabh_accredited.json. Pass MAX_PAGES=N to cap a test run, or RESUME=1 to
# continue an interrupted crawl from its checkpoint.
nabh-scrape:
	cd gift_india_api && $(PYTHON) -m src.nabh_scraper \
		$(if $(MAX_PAGES),--max-pages $(MAX_PAGES),) \
		$(if $(RESUME),--resume,)

# Land the NABH directory into bronze.facilities_nabh (upsert, idempotent).
load-nabh:
	cd gift_india_api && $(PYTHON) -m src.load_nabh $(if $(SOURCE),--source $(SOURCE),)

# Scrape the NABH directory, then land the accreditation rows. dbt then resolves
# orgs to facility_ids (gold.facility_nabh) and flags gold.facilities.nabh_accredited.
nabh: nabh-scrape load-nabh

# Scrape registered hospitals from NHPR/HFR (public web scrape, no API token) into
# data/nhpr/nhpr_hospitals.json. Pass MAX_STATES=N or SEARCH_TOKENS="hospital"
# to cap a test run, or RESUME=1 to continue an interrupted crawl.
nhpr-scrape:
	cd gift_india_api && $(PYTHON) -m src.nhpr_scraper \
		$(if $(MAX_STATES),--max-states $(MAX_STATES),) \
		$(if $(MAX_PAGES),--max-pages $(MAX_PAGES),) \
		$(if $(RESUME),--resume,) \
		$(if $(SEARCH_TOKENS),--search-tokens $(SEARCH_TOKENS),) \
		$(if $(FIXTURE_DIR),--fixture-dir $(FIXTURE_DIR),)

# Land NHPR hospital rows into bronze.locations_nhpr (upsert, idempotent).
load-nhpr:
	cd gift_india_api && $(PYTHON) -m src.load_nhpr $(if $(SOURCE),--source $(SOURCE),)

# Scrape NHPR hospitals (search + facilityDetail for beds), then land in bronze.
nhpr: nhpr-scrape load-nhpr

# Scrape PMJAY empanelled hospitals (hospitals.pmjay.gov.in HEM search) into
# data/bronze_pmjay/facilities_pmjay.json.
#   Full national crawl (resumable, throttled):
#     make pmjay-scrape DELAY=1.5 RESUME=1
#     make load-pmjay
#   Test offline:  make pmjay-scrape FIXTURE=1
#   Scope a state: make pmjay-scrape STATE=Karnataka DELAY=1
pmjay-scrape:
	cd gift_india_api && $(PYTHON) -m src.pmjay_scraper \
		$(if $(FIXTURE),--fixture-dir tests/fixtures/pmjay,) \
		$(if $(STATE),--state $(STATE),) \
		$(if $(DISTRICT),--district $(DISTRICT),) \
		$(if $(MAX_STATES),--max-states $(MAX_STATES),) \
		$(if $(MAX_DISTRICTS),--max-districts $(MAX_DISTRICTS),) \
		$(if $(RESUME),--resume,) \
		$(if $(DELAY),--delay $(DELAY),) \
		$(if $(TIMEOUT),--timeout $(TIMEOUT),) \
		$(if $(RETRIES),--retries $(RETRIES),)

# Land PMJAY hospital rows into bronze.facilities_pmjay (upsert, idempotent).
load-pmjay:
	cd gift_india_api && $(PYTHON) -m src.load_pmjay $(if $(SOURCE),--source $(SOURCE),)

# Scrape the PMJAY directory, then land the empanelment rows in bronze.
pmjay: pmjay-scrape load-pmjay

# Run the gift_india_api Python unit tests (scraper + crawl loader).
# Needs pytest: pip install pytest (or add it to your dev environment).
test:
	cd gift_india_api && $(PYTHON) -m pytest

# Fetch the Medical Value Travel (MVT) hospital seed from Hugging Face into the
# data/medical_travel cache, then upsert it into bronze.locations_medical_travel
# (idempotent on the source hospital id). Pass REFRESH=1 to re-download.
#   local:    make med-travel
#   lakebase: make med-travel TARGET=lakebase ENDPOINT=projects/.../endpoints/primary PROFILE=<profile>
med-travel:
	cd gift_india_api && $(PYTHON) -m src.load_med_travel \
		$(if $(REFRESH),--refresh,) \
		$(if $(filter lakebase,$(TARGET)),--target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),),)

# Land the SimplyGIS SOI shapefiles' flat attributes into
# bronze.soi_shapefile_features (states, districts, boundary, world countries).
# Files live in data/simplygis/; pass DOWNLOAD=1 to (re)fetch them first.
# Usage: make shapefiles [DOWNLOAD=1]
shapefiles:
	cd gift_india_api && $(PYTHON) -m src.load_shapefiles $(if $(DOWNLOAD),--download,)

# Usage: make publish ENDPOINT=projects/<id>/branches/production/endpoints/<ep> PROFILE=<profile>
# Lands raw data in Lakebase `bronze`. Build silver/gold against Lakebase after
# this by pointing the dbt profile at the endpoint (export GIFT_INDIA_PGHOST/
# PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE=require, then `make dbt`).
publish:
	@test -n "$(ENDPOINT)" || (echo "ERROR: set ENDPOINT=projects/.../endpoints/<id>"; exit 1)
	cd gift_india_api && $(PYTHON) -m src.load_db --target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),)

# Verify Postgres credentials before dbt (password from GIFT_INDIA_DB_URL or GIFT_INDIA_PGPASSWORD).
pg-check:
	@$(LOAD_GIFT_ENV) && cd gift_india_api && $(PYTHON) -m src.pg_env --check

# Build the dbt medallion (bronze sources -> silver -> gold) + run its tests.
# Requires `pip install -r gift_india_dbt/requirements.txt` and a loaded warehouse.
# Loads repo `.env` (+ `.env.local`) and syncs GIFT_INDIA_PG* from GIFT_INDIA_DB_URL.
# See claude.md — system Postgres :5432; no Docker unless you opt in.
# For Lakebase: export PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE before running.
dbt: pg-check
	@$(LOAD_GIFT_ENV) && cd gift_india_dbt && DBT_PROFILES_DIR=. $(PYTHON) -m dbt build

dbt-test: pg-check
	@$(LOAD_GIFT_ENV) && cd gift_india_dbt && DBT_PROFILES_DIR=. $(PYTHON) -m dbt test

dbt-docs: pg-check
	@$(LOAD_GIFT_ENV) && cd gift_india_dbt && DBT_PROFILES_DIR=. $(PYTHON) -m dbt docs generate && DBT_PROFILES_DIR=. $(PYTHON) -m dbt docs serve

# Build the upstream Databricks medallion (dbt_project/, adapter: databricks).
# Runs the dbt SQL on the workspace SQL warehouse — needs the Databricks CLI
# authenticated (DATABRICKS_CONFIG_PROFILE, default `gift-india`; see startup.sh)
# and the dbt-databricks toolchain (pip install -r dbt_project/requirements.txt).
dbt-databricks:
	cd dbt_project && DATABRICKS_CONFIG_PROFILE=$(or $(PROFILE),gift-india-mb) dbt deps && \
		DATABRICKS_CONFIG_PROFILE=$(or $(PROFILE),gift-india-mb) dbt build

# Full transform across BOTH warehouses (the two medallions are independent
# runtimes, so this just builds each):
#   1. dbt-databricks — governed Delta Share → gold capability/metric marts (Databricks)
#   2. data           — bronze load → silver/gold serving tables the app reads (Postgres)
pipeline: dbt-databricks data

# Layer 2: LLM narration → gold.capability_evidence_json/md.
# Default: serving mode + GPT-OSS 20B (no SQL warehouse). Pilot districts first.
#   make narrate-pilot PROFILE=gift-india-mb LIMIT=50
#   make narrate-evidence PILOT=1 MODE=serving PROFILE=gift-india-mb
# Lakebase:
#   make narrate-evidence TARGET=lakebase ENDPOINT=projects/.../endpoints/primary PROFILE=gift-india-mb PILOT=1
# Offline dev only (no Databricks):
#   make narrate-pilot-stub LIMIT=50
narrate-pilot-stub:
	@$(LOAD_GIFT_ENV) && cd gift_india_api && $(PYTHON) -m src.pg_env --check && \
	$(PYTHON) -m src.narrate_evidence --pilot --mode stub \
		$(if $(LIMIT),--limit $(LIMIT),)

narrate-pilot:
	@$(LOAD_GIFT_ENV) && cd gift_india_api && $(PYTHON) -m src.pg_env --check && \
	$(PYTHON) -m src.narrate_evidence --pilot --mode serving \
		--agent-endpoint databricks-gpt-oss-20b \
		$(if $(filter 0,$(SKIP)),--no-skip-existing,) \
		$(if $(LIMIT),--limit $(LIMIT),) \
		$(if $(PROFILE),--profile $(PROFILE),)

narrate-evidence:
	@$(LOAD_GIFT_ENV) && cd gift_india_api && \
	$(if $(filter lakebase,$(TARGET)),,$(PYTHON) -m src.pg_env --check &&) \
	$(PYTHON) -m src.narrate_evidence \
		$(if $(PILOT),--pilot,) \
		$(if $(filter 0,$(SKIP)),--no-skip-existing,) \
		$(if $(LIMIT),--limit $(LIMIT),) \
		$(if $(CAPABILITY),--capability $(CAPABILITY),) \
		$(if $(MODE),--mode $(MODE),) \
		$(if $(WAREHOUSE),--warehouse $(WAREHOUSE),) \
		$(if $(AGENT),--agent-endpoint $(AGENT),) \
		$(if $(filter lakebase,$(TARGET)),--target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),),) \
		$(if $(PROFILE),--profile $(PROFILE),)
