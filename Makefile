# gift_india India — common dev tasks.
#
#   make db-up      start local Postgres (docker compose)
#   make load       generate + load the dataset into local Postgres
#   make run        run the Streamlit app locally
#   make db-down    stop local Postgres (keeps data)
#   make db-reset   stop + wipe the data volume, then start fresh
#   make publish    publish the dataset to Lakebase (set ENDPOINT, PROFILE)

.PHONY: db-up db-down db-reset load run scrape publish

db-up:
	docker compose up -d
	@echo "Postgres is starting on localhost:5432 (db: gift_india)."

db-down:
	docker compose down

db-reset:
	docker compose down -v
	docker compose up -d

load:
	python -m src.load_db $(if $(FORCE),--force,)

run:
	streamlit run app.py

# Scrape facility official websites into data/scraped/.
# Usage: make scrape [INPUT=data/facility_urls.csv] [LIMIT=20]
scrape:
	python -m src.scraper $(if $(INPUT),--input $(INPUT),) $(if $(LIMIT),--limit $(LIMIT),)

# Usage: make publish ENDPOINT=projects/<id>/branches/production/endpoints/<ep> PROFILE=<profile>
publish:
	@test -n "$(ENDPOINT)" || (echo "ERROR: set ENDPOINT=projects/.../endpoints/<id>"; exit 1)
	python -m src.load_db --target lakebase --endpoint $(ENDPOINT) $(if $(PROFILE),--profile $(PROFILE),)
