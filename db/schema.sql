-- Governance, Integrity, & Facility Trust (GIFT) Gauge — bronze landing schema (raw tables the loader writes).
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

-- Legacy table renamed to bronze.facilities_virtue (see feb96f3). Drop if an old
-- warehouse still has the pre-rename object.
DROP TABLE IF EXISTS bronze.facilities CASCADE;

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
--
-- Virtue Foundation facilities are loaded into this table via
-- `gift_india_api/src/load_bronze_real.py` (and the synthetic demo loader loads
-- into the same table so dbt models stay simple).
CREATE TABLE IF NOT EXISTS bronze.facilities_virtue (
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
    CONSTRAINT facilities_virtue_district_fk
        FOREIGN KEY (district, state)
        REFERENCES bronze.districts (district, state)
);

CREATE INDEX IF NOT EXISTS facilities_virtue_district_idx
    ON bronze.facilities_virtue (district, state);
CREATE INDEX IF NOT EXISTS facilities_virtue_offers_surgery_idx
    ON bronze.facilities_virtue (offers_surgery);

-- Real Virtue Foundation per-facility capability trust assessments (landed
-- from data/virtue/facility_capability_assessments.csv via
-- `gift_india_api/src/load_bronze_real.py`).
CREATE TABLE IF NOT EXISTS bronze.facility_capability_assessments_virtue (
    facility_id             text        NOT NULL REFERENCES bronze.facilities_virtue(facility_id),
    capability              text        NOT NULL,
    capability_label        text,
    capability_description  text,
    claimed                 boolean,
    trust_signal            text,
    trust_score             numeric,
    evidence_count          integer,
    supporting_count        integer,
    contradicting_count     integer,
    best_source             text,
    summary                 text,
    PRIMARY KEY (facility_id, capability)
);

CREATE INDEX IF NOT EXISTS facility_capability_assessments_virtue_capability_idx
    ON bronze.facility_capability_assessments_virtue (capability);
CREATE INDEX IF NOT EXISTS facility_capability_assessments_virtue_trust_signal_idx
    ON bronze.facility_capability_assessments_virtue (trust_signal);

-- Raw crawl payloads from each facility's official website (src/scraper.py),
-- landed by src/load_crawl.py. This is the append-target bronze table that keeps
-- source-native fidelity: the verbatim `raw_html` plus boilerplate-stripped
-- `raw_text` are the replayable input to the silver extraction step.
--
-- `facility_id` is a PROVISIONAL link (the scrape can come from an ad-hoc URL
-- list), so there is intentionally NO foreign key to bronze.facilities_virtue. Failed
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

-- JCI (Joint Commission International) accredited organizations in India, seeded
-- from the curated medical-tourism aggregator lists (a sample spot-checked
-- against the official JCI directory, which blocks bulk export), landed by
-- src/load_jci.py. This is an external accreditation REFERENCE source, not a
-- facility record — there is intentionally NO foreign key to bronze.facilities_virtue;
-- entity resolution to a facility_id happens downstream in dbt (silver -> gold
-- crosswalk) on the normalized `match_name` / `brand_key`. `data_source` tags
-- the provenance ('jci') so the lineage of the accreditation flag is explicit.
-- Loads are idempotent on `jci_org_id` = sha256(match_name + city + state)[:16].
ALTER TABLE IF EXISTS bronze.jci_accreditations RENAME TO facilities_jci;
ALTER INDEX IF EXISTS bronze.jci_accreditations_match_name_idx RENAME TO facilities_jci_match_name_idx;
ALTER INDEX IF EXISTS bronze.jci_accreditations_state_idx RENAME TO facilities_jci_state_idx;
CREATE TABLE IF NOT EXISTS bronze.facilities_jci (
    jci_org_id            text        PRIMARY KEY,
    jci_name              text        NOT NULL,
    city                  text,
    state                 text,
    country               text        NOT NULL DEFAULT 'India',
    accreditation_program text,
    accreditation_decision text,                 -- portal decision, e.g. 'Accredited'
    effective_date        date,                  -- accreditation effective date (or null)
    match_name            text        NOT NULL,  -- normalized name (entity-resolution key)
    brand_key             text,                  -- first 2 significant tokens
    website_url           text,                  -- official hospital homepage (scrape target)
    snapshot_dir          text,                  -- relative path to the scraped page snapshot
    verified_on_portal    boolean     NOT NULL DEFAULT false,
    source                text,                  -- aggregator the row came from
    source_url            text,
    data_source           text        NOT NULL DEFAULT 'jci',
    collected_at          timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS facilities_jci_match_name_idx
    ON bronze.facilities_jci (match_name);
CREATE INDEX IF NOT EXISTS facilities_jci_state_idx
    ON bronze.facilities_jci (state);

-- NABH (National Accreditation Board for Hospitals & Healthcare Providers)
-- accredited / certified / empanelled facilities in India, scraped from the
-- official nabh.co directory by src/nabh_scraper.py and landed by src/load_nabh.py.
-- Like bronze.facilities_jci this is an external accreditation REFERENCE source
-- (`data_source` = 'nabh'), NOT a governed facility record — so there is no foreign
-- key to bronze.facilities_virtue; entity resolution to a facility_id happens downstream in
-- dbt on the shared normalized `match_name` / `brand_key` (the `jci_normalize`
-- macro), exactly as for JCI. Unlike the curated JCI seed this is the full national
-- register (~19k orgs) with geocoordinates, so gold.facility_nabh resolves a much
-- larger share of facilities and confirms the on-record "NABH accredited" claims.
-- Loads are idempotent on `nabh_org_id` = sha256(match_name + city + state + ref)[:16].
ALTER TABLE IF EXISTS bronze.nabh_accreditations RENAME TO facilities_nabh;
ALTER INDEX IF EXISTS bronze.nabh_accreditations_match_name_idx RENAME TO facilities_nabh_match_name_idx;
ALTER INDEX IF EXISTS bronze.nabh_accreditations_state_idx RENAME TO facilities_nabh_state_idx;
CREATE TABLE IF NOT EXISTS bronze.facilities_nabh (
    nabh_org_id           text        PRIMARY KEY,
    nabh_name             text        NOT NULL,
    city                  text,
    state                 text,
    pincode               text,
    country               text        NOT NULL DEFAULT 'India',
    accreditation_program text,                  -- e.g. 'Hospitals', 'SHCO', 'AYUSH Hospitals'
    accreditation_status  text,                  -- 'Accredited' | 'Empaneled' | 'Certified'
    reference_no          text,                  -- NABH accreditation / reference number
    certificate_url       text,                  -- stable portal certificate-and-scope PDF (or null)
    address               text,                  -- full free-text address as published
    match_name            text        NOT NULL,  -- normalized name (entity-resolution key)
    brand_key             text,                  -- first 2 significant tokens
    website_url           text,                  -- official hospital homepage (scrape target)
    phone                 text,
    lat                   double precision,      -- directory-provided geocoordinate (or null)
    lng                   double precision,
    verified_on_portal    boolean     NOT NULL DEFAULT true,   -- this IS the official portal
    source                text,
    source_url            text,
    data_source           text        NOT NULL DEFAULT 'nabh',
    collected_at          timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS facilities_nabh_match_name_idx
    ON bronze.facilities_nabh (match_name);
CREATE INDEX IF NOT EXISTS facilities_nabh_state_idx
    ON bronze.facilities_nabh (state);

-- Medical Value Travel (MVT) hospital locations — India hospitals running
-- international patient programs, seeded from the public Hugging Face MVT MVP
-- dataset (Dhanush008/india-medical-value-travel-mvp), landed by
-- src/load_med_travel.py into data/medical_travel/. Like bronze.facilities_jci
-- this is an external REFERENCE source describing a hospital's medical-tourism
-- posture (program tier, accreditations, specialties, countries served), NOT a
-- governed facility record — so there is intentionally NO foreign key to
-- bronze.facilities_virtue; entity resolution to a facility_id happens downstream in
-- dbt on the normalized `match_name` / `brand_key`. List-valued source fields
-- (`specialties`, `countries_served`, `accreditation`) are stored pipe-delimited,
-- matching bronze.facilities_virtue.specialties. Loads are idempotent on `mvt_id` (the
-- source hospital id, e.g. 'H001').
CREATE TABLE IF NOT EXISTS bronze.locations_medical_travel (
    mvt_id                         text        PRIMARY KEY,
    name                           text        NOT NULL,
    hospital_chain                 text,
    city                           text,
    state                          text,
    tier                           integer,
    international_patient_program  text,                 -- 'full' | 'partial'
    specialties                    text        NOT NULL DEFAULT '',  -- pipe-delimited
    countries_served               text        NOT NULL DEFAULT '',  -- pipe-delimited
    has_ipc                        boolean     NOT NULL DEFAULT false, -- international patient centre
    accreditation                  text        NOT NULL DEFAULT '',  -- pipe-delimited (e.g. NABH|JCI)
    avg_cost_index                 text,                 -- 'low' | 'medium' | 'high'
    beds                           integer,
    established_year               integer,
    international_patients_annually integer,
    phone                          text,
    email                          text,
    website_url                    text,
    match_name                     text        NOT NULL, -- normalized name (entity-resolution key)
    brand_key                      text,                 -- first 2 significant tokens
    data_source                    text        NOT NULL DEFAULT 'mvt',
    source_url                     text,
    collected_at                   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS locations_medical_travel_match_name_idx
    ON bronze.locations_medical_travel (match_name);
CREATE INDEX IF NOT EXISTS locations_medical_travel_state_idx
    ON bronze.locations_medical_travel (state);

-- NHPR / HFR registered hospitals — scraped from nhpr.abdm.gov.in via
-- src/nhpr_scraper.py (search + facilityDetail) and landed by src/load_nhpr.py.
-- External REFERENCE source (`data_source` = 'nhpr'); entity resolution to
-- facility_id happens downstream in dbt on match_name / brand_key. Bed-capacity
-- columns come from the facilityDetail infrastructure payload; full fidelity is
-- preserved in detail_json / search_json. Idempotent on nhpr_facility_id (HFR id).
CREATE TABLE IF NOT EXISTS bronze.locations_nhpr (
    nhpr_facility_id                  text             PRIMARY KEY,
    facility_name                     text             NOT NULL,
    facility_status                   text,
    facility_type                     text,
    facility_type_code                text,
    ownership                         text,
    ownership_code                    text,
    system_of_medicine                text,
    system_of_medicine_code           text,
    state_name                        text,
    state_lgd_code                    text,
    district_name                     text,
    district_lgd_code                 text,
    sub_district_name                 text,
    sub_district_lgd_code             text,
    village_city_town_name            text,
    address                           text,
    pincode                           text,
    latitude                          double precision,
    longitude                         double precision,
    website_url                       text,
    phone                             text,
    email                             text,
    total_beds                        integer,
    ipd_beds_with_oxygen              integer,
    ipd_beds_without_oxygen           integer,
    icu_beds_with_ventilators         integer,
    icu_beds_without_ventilators      integer,
    hdu_beds_with_ventilators         integer,
    hdu_beds_without_ventilators      integer,
    hdu_beds_with_functional_ventilators integer,
    day_care_beds_with_oxygen         integer,
    day_care_beds_without_oxygen      integer,
    dental_chairs                     integer,
    total_ventilators                 integer,
    specialities                      text             NOT NULL DEFAULT '',
    imaging_services                  text             NOT NULL DEFAULT '',
    diagnostic_services               text             NOT NULL DEFAULT '',
    match_name                        text             NOT NULL,
    brand_key                         text,
    detail_json                       jsonb,
    search_json                       jsonb,
    verified_on_portal                boolean          NOT NULL DEFAULT true,
    source                            text,
    source_url                        text,
    data_source                       text             NOT NULL DEFAULT 'nhpr',
    collected_at                      timestamptz      NOT NULL
);

CREATE INDEX IF NOT EXISTS locations_nhpr_match_name_idx
    ON bronze.locations_nhpr (match_name);
CREATE INDEX IF NOT EXISTS locations_nhpr_state_idx
    ON bronze.locations_nhpr (state_name);
CREATE INDEX IF NOT EXISTS locations_nhpr_total_beds_idx
    ON bronze.locations_nhpr (total_beds);

-- PMJAY (Ayushman Bharat) empanelled hospitals in India, scraped from the official
-- Hospital Empanelment Module (HEM) public search portal (hospitals.pmjay.gov.in)
-- by src/pmjay_scraper.py and landed by src/load_pmjay.py. Like
-- bronze.facilities_nabh this is an external REFERENCE source (`data_source` =
-- 'pmjay'), NOT a governed facility record — entity resolution to a facility_id
-- happens downstream in dbt on the shared normalized `match_name` / `brand_key`.
-- Loads are idempotent on `pmjay_org_id` = sha256(match_name + district + state
-- + hecp_id)[:16].
CREATE TABLE IF NOT EXISTS bronze.facilities_pmjay (
    pmjay_org_id           text        PRIMARY KEY,
    pmjay_name             text        NOT NULL,
    hecp_id                text,                  -- PMJAY EHCP / hospital reference id
    hospital_type          text,                  -- Public | Private (For Profit) | Private (Not For Profit)
    district               text,
    state                  text,
    pincode                text,
    country                text        NOT NULL DEFAULT 'India',
    address                text,
    email                  text,
    phone                  text,
    specialties            text        NOT NULL DEFAULT '',  -- pipe-delimited empanelled specialties
    specialties_upgraded   text        NOT NULL DEFAULT '',  -- pipe-delimited upgraded specialties
    empanelment_scheme     text,                  -- AB-PMJAY | state-integrated scheme
    nabh_status            text,                  -- NABH accreditation grade if published
    bed_strength           integer,
    lat                    double precision,
    lng                    double precision,
    pmjay_state_code       text,                  -- internal portal state id
    pmjay_district_code    text,                  -- internal portal district id
    match_name             text        NOT NULL,  -- normalized name (entity-resolution key)
    brand_key              text,                  -- first 2 significant tokens
    verified_on_portal     boolean     NOT NULL DEFAULT true,
    source                 text,
    source_url             text,
    data_source            text        NOT NULL DEFAULT 'pmjay',
    collected_at           timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS facilities_pmjay_match_name_idx
    ON bronze.facilities_pmjay (match_name);
CREATE INDEX IF NOT EXISTS facilities_pmjay_state_idx
    ON bronze.facilities_pmjay (state);
CREATE INDEX IF NOT EXISTS facilities_pmjay_district_idx
    ON bronze.facilities_pmjay (district, state);

-- Agent Bricks narration outputs (built by gift_india_api/src/narrate_evidence.py).
-- Deterministic scores live in gold.capability_scored (dbt); these tables hold
-- the default LLM assessment — planner overrides in app.capability_overrides win.
CREATE TABLE IF NOT EXISTS gold.capability_evidence_json (
    facility_id               text NOT NULL,
    facility_name             text,
    capability                text NOT NULL,
    evidence_strength_score   numeric,
    evidence_tier             text,
    assessment_json           jsonb NOT NULL,
    model_endpoint            text,
    narrated_at               timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (facility_id, capability)
);

CREATE TABLE IF NOT EXISTS gold.capability_evidence_md (
    facility_id               text NOT NULL,
    facility_name             text,
    capability                text NOT NULL,
    evidence_strength_score   numeric,
    evidence_tier             text,
    assessment_md             text NOT NULL,
    model_endpoint            text,
    narrated_at               timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (facility_id, capability)
);

CREATE INDEX IF NOT EXISTS capability_evidence_json_tier_idx
    ON gold.capability_evidence_json (capability, evidence_tier);
CREATE INDEX IF NOT EXISTS capability_evidence_md_tier_idx
    ON gold.capability_evidence_md (capability, evidence_tier);
