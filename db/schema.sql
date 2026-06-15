-- gift_india India — serving schema (the tables the app reads).
--
-- This DDL is intentionally Postgres-portable so the SAME script runs against:
--   * local Postgres (docker compose, see docker-compose.yml), and
--   * Databricks Lakebase (managed serverless Postgres).
--
-- Tables live in `public` so local dev mirrors what src/data.py reads from
-- Lakebase. Columns match the engine's expectations (see src/matching.py).
-- The NFHS-5 district indicator columns are nullable: the live governed dataset
-- populates them; the synthetic dev dataset leaves them empty.

-- District reference + NFHS-5 health indicators.
CREATE TABLE IF NOT EXISTS public.districts (
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
CREATE TABLE IF NOT EXISTS public.facilities (
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
        REFERENCES public.districts (district, state)
);

CREATE INDEX IF NOT EXISTS facilities_district_idx
    ON public.facilities (district, state);
CREATE INDEX IF NOT EXISTS facilities_offers_surgery_idx
    ON public.facilities (offers_surgery);
