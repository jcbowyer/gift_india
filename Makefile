# Governance, Integrity, & Facility Trust (GIFT) Desk — common dev tasks.
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

.PHONY: db-up db-down db-reset load load-real data pipeline web scrape load-crawl crawl jci-scrape load-jci load-jci-crawl jci shapefiles test publish dbt dbt-test dbt-docs dbt-databricks

db-up:
	docker compose up -d
	@echo "Postgres is starting on localhost:5432 (db: gift_india)."

db-down:
	docker compose down

db-reset:
	docker compose down -v
	docker compose up -d

# Data loaders live in gift_india_api/src and use package-relative imports.
# Lands the raw dataset in the `bronze` schema (db/schema.sql); dbt promotes it.
load:
	cd gift_india_api && python -m src.load_db $(if $(FORCE),--force,)

# Full local data loop: land raw in bronze, then build silver + gold via dbt so
# the app (which reads gold) has serving tables. Needs the dbt toolchain
# (pip install -r gift_india_dbt/requirements.txt) and a running warehouse.
data: load dbt

# --- REAL governed Virtue Foundation data (fast path, no bronze/dbt rebuild) ---
# Export the four gold.* serving tables straight from the VF Delta Share into
# data/gold_real/*.csv. Needs the Databricks CLI authenticated; override the
# read source via PROFILE / WAREHOUSE.
export-gold-real:
	PROFILE=$(or $(PROFILE),gift-india-mb) WAREHOUSE=$(or $(WAREHOUSE),234ccf680e359443) python data/export_gold_real.py

# Land the REAL VF rows (data/gold_real/*.csv) into bronze.* so the dbt medallion
# (silver/gold + JCI entity resolution) runs on real names instead of the
# synthetic demo set. Follow with `make dbt`. Use this instead of `make load`
# when you want real data through the medallion.
#   make load-real && make dbt
load-real:
	cd gift_india_api && python -m src.load_bronze_real \
		$(if $(filter lakebase,$(TARGET)),--target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),),)

# Load data/gold_real/*.csv into the gold.* schema the app reads.
#   local:    make load-gold-real
#   lakebase: make load-gold-real TARGET=lakebase ENDPOINT=projects/.../endpoints/primary PROFILE=<profile>
load-gold-real:
	cd gift_india_api && python -m src.load_gold_real \
		$(if $(filter lakebase,$(TARGET)),--target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),),)

# Run the web app (React client + Express server) in dev mode.
web:
	cd gift_india_web && npm run dev

# Scrape facility official websites into data/scraped/.
# Scoped to the pilot districts by default (CRAWL_REGIONS in src/scraper.py);
# pass ALL=1 to crawl every facility with a website_url.
# Usage: make scrape [INPUT=data/facility_urls.csv] [LIMIT=20] [ALL=1]
scrape:
	cd gift_india_api && python -m src.scraper $(if $(INPUT),--input $(INPUT),) $(if $(LIMIT),--limit $(LIMIT),) $(if $(ALL),--all-districts,)

# Land the scraped snapshots into bronze.facility_web_crawl (append, idempotent).
# Usage: make load-crawl [SOURCE=data/scraped]
load-crawl:
	cd gift_india_api && python -m src.load_crawl $(if $(SOURCE),--source $(SOURCE),)

# Scrape the official websites AND land them in bronze in one step.
# Scoped to the pilot districts by default; pass ALL=1 to crawl everywhere.
# Usage: make crawl [INPUT=data/facility_urls.csv] [LIMIT=20] [ALL=1]
crawl: scrape load-crawl

# Compile the JCI seed for India into data/jci/ AND snapshot each hospital's
# official homepage under data/jci/scraped/<state>/<district>/<name>-<id>/.
# Pass NO_PAGES=1 to skip the homepage snapshots (offline/deterministic), or
# FETCH_OFFICIAL=1 to also try the live (usually bot-blocked) JCI directory.
jci-scrape:
	cd gift_india_api && python -m src.jci_scraper \
		$(if $(NO_PAGES),,--scrape-pages) \
		$(if $(FETCH_OFFICIAL),--fetch-official,) \
		$(if $(LIMIT),--limit $(LIMIT),)

# Land the JCI seed into bronze.jci_accreditations (upsert, idempotent).
load-jci:
	cd gift_india_api && python -m src.load_jci $(if $(SOURCE),--source $(SOURCE),)

# Land the scraped JCI homepage snapshots into bronze.facility_web_crawl (the same
# raw-crawl table the facility crawler uses; append, idempotent).
load-jci-crawl:
	cd gift_india_api && python -m src.load_crawl --source ../data/jci/scraped

# Compile the JCI seed + snapshot homepages, then land BOTH the accreditation rows
# (bronze.jci_accreditations) and the page snapshots (bronze.facility_web_crawl).
# dbt then resolves orgs to facility_ids (gold.facility_jci) and flags
# gold.facilities.jci_accredited.
jci: jci-scrape load-jci load-jci-crawl

# Run the gift_india_api Python unit tests (scraper + crawl loader).
# Needs pytest: pip install pytest (or add it to your dev environment).
test:
	cd gift_india_api && python -m pytest

# Land the SimplyGIS SOI shapefiles' flat attributes into
# bronze.soi_shapefile_features (states, districts, boundary, world countries).
# Files live in data/simplygis/; pass DOWNLOAD=1 to (re)fetch them first.
# Usage: make shapefiles [DOWNLOAD=1]
shapefiles:
	cd gift_india_api && python -m src.load_shapefiles $(if $(DOWNLOAD),--download,)

# Usage: make publish ENDPOINT=projects/<id>/branches/production/endpoints/<ep> PROFILE=<profile>
# Lands raw data in Lakebase `bronze`. Build silver/gold against Lakebase after
# this by pointing the dbt profile at the endpoint (export GIFT_INDIA_PGHOST/
# PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE=require, then `make dbt`).
publish:
	@test -n "$(ENDPOINT)" || (echo "ERROR: set ENDPOINT=projects/.../endpoints/<id>"; exit 1)
	cd gift_india_api && python -m src.load_db --target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),)

# Build the dbt medallion (bronze sources -> silver -> gold) + run its tests.
# Requires `pip install -r gift_india_dbt/requirements.txt` and a loaded warehouse
# (`make db-up && make load`). Override the connection via GIFT_INDIA_PG* env vars.
dbt:
	cd gift_india_dbt && DBT_PROFILES_DIR=. dbt build

dbt-test:
	cd gift_india_dbt && DBT_PROFILES_DIR=. dbt test

dbt-docs:
	cd gift_india_dbt && DBT_PROFILES_DIR=. dbt docs generate && DBT_PROFILES_DIR=. dbt docs serve

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
