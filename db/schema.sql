-- gift_india India — bronze landing schema (raw tables the loader writes).
--
-- This is the BRONZE layer of the medallion: raw, append-target facility and
-- district records, kept out of `public` so `public` is left to the managed
-- Postgres / Lakebase system objects only. dbt promotes these through
-- `silver.*` and serves them from `gold.*`; the app reads GOLD, never bronze.
--
-- This DDL is intentionally Postgres-portable so the SAME script runs against:
--   * local Postgres (docker compose, see docker-compose.yml), and
--   * Databricks Lakebase (managed serverless Postgres).
--
-- Columns match the engine's expectations (see gift_india_dbt/models/silver).
-- The NFHS-5 district indicator columns are nullable: the live governed dataset
-- populates them; the synthetic dev dataset leaves them empty.

CREATE SCHEMA IF NOT EXISTS bronze;

-- District reference + NFHS-5 health indicators.
CREATE TABLE IF NOT EXISTS bronze.districts (
    district                text             NOT NULL,
    state                   text             NOT NULL,
    lat                     double precision NOT NULL,
    lon                     double precision NOT NULL,
    population              integer          NOT NULL,
    urbanity                double precision NOT NULL,
    fp_unmet_pct            double precision,
    institutional_birth_pct double precision,
    csection_pct            double precision,
    anaemia_pct             double precision,
    PRIMARY KEY (district, state)
);

-- Geotagged healthcare facilities (entity-resolved, with a match-confidence
-- score). `specialties` is a pipe-delimited list, as produced by the pipeline.
CREATE TABLE IF NOT EXISTS bronze.facilities (
    facility_id      text             PRIMARY KEY,
    name             text             NOT NULL,
    type             text             NOT NULL,
    district         text             NOT NULL,
    state            text             NOT NULL,
    lat              double precision NOT NULL,
    lon              double precision NOT NULL,
    beds             integer          NOT NULL DEFAULT 0,
    annual_surgeries integer          NOT NULL DEFAULT 0,
    offers_surgery   boolean          NOT NULL DEFAULT false,
    specialties      text             NOT NULL DEFAULT '',
    website_url      text,
    match_confidence double precision NOT NULL,
    CONSTRAINT facilities_district_fk
        FOREIGN KEY (district, state)
        REFERENCES bronze.districts (district, state)
);

CREATE INDEX IF NOT EXISTS facilities_district_idx
    ON bronze.facilities (district, state);
CREATE INDEX IF NOT EXISTS facilities_offers_surgery_idx
    ON bronze.facilities (offers_surgery);

-- Raw crawl payloads from each facility's official website (src/scraper.py),
-- landed by src/load_crawl.py. This is the append-target bronze table that keeps
-- source-native fidelity: the verbatim `raw_html` plus boilerplate-stripped
-- `raw_text` are the replayable input to the silver extraction step.
--
-- `facility_id` is a PROVISIONAL link (the scrape can come from an ad-hoc URL
-- list), so there is intentionally NO foreign key to bronze.facilities. Failed
-- attempts are landed too (http_status/raw_* NULL) to preserve crawl provenance.
CREATE TABLE IF NOT EXISTS bronze.facility_web_crawl (
    crawl_id     text        PRIMARY KEY,  -- sha256(website_url + crawled_at)
    facility_id  text,
    name         text,
    website_url  text        NOT NULL,
    final_url    text,
    crawled_at   timestamptz NOT NULL,
    status       text        NOT NULL,     -- ok | http_error | fetch_error
    http_status  integer,
    content_type text,
    title        text,
    raw_html     text,
    raw_text     text,
    error        text
);

CREATE INDEX IF NOT EXISTS facility_web_crawl_facility_idx
    ON bronze.facility_web_crawl (facility_id);
CREATE INDEX IF NOT EXISTS facility_web_crawl_crawled_at_idx
    ON bronze.facility_web_crawl (crawled_at);
