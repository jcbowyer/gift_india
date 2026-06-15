-- gift_india India — bronze landing schema (raw tables the loader writes).
--
-- This is the BRONZE layer of the medallion: raw, append-target facility and
-- district records, kept out of `public` so `public` is left to the managed
-- Postgres / Lakebase (Neon) system objects only. dbt promotes these through
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
