# gift_india India — common dev tasks.
#
#   make db-up      start local Postgres (docker compose)
#   make load       generate + land the raw dataset into the bronze schema
#   make data       full medallion loop: load (bronze) + dbt build (silver/gold)
#   make db-down    stop local Postgres (keeps data)
#   make db-reset   stop + wipe the data volume, then start fresh
#   make web        run the gift_india_web app locally (npm run dev)
#   make publish    publish the dataset to Lakebase (set ENDPOINT, PROFILE)

.PHONY: db-up db-down db-reset load data web scrape publish dbt dbt-test dbt-docs

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

# Run the web app (React client + Express server) in dev mode.
web:
	cd gift_india_web && npm run dev

# Scrape facility official websites into data/scraped/.
# Usage: make scrape [INPUT=data/facility_urls.csv] [LIMIT=20]
scrape:
	cd gift_india_api && python -m src.scraper $(if $(INPUT),--input $(INPUT),) $(if $(LIMIT),--limit $(LIMIT),)

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
