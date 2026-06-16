-- GIFT Gauge table and column comments for Genie (AI/BI natural-language SQL).
-- Applied by scripts/apply_table_comments.py after schema load.
-- dbt persist_docs handles silver/gold dbt models and seeds separately.

-- ---------------------------------------------------------------------------
-- bronze — raw landing tables (Python loaders)
-- ---------------------------------------------------------------------------

COMMENT ON TABLE bronze.districts IS
  'Bronze district reference with NFHS-5 health indicators. One row per (district, state). Feeds silver_geography.';

COMMENT ON COLUMN bronze.districts.district IS 'District name within the state.';
COMMENT ON COLUMN bronze.districts.state IS 'Indian state or union territory name.';
COMMENT ON COLUMN bronze.districts.lat IS 'District centroid latitude (WGS84).';
COMMENT ON COLUMN bronze.districts.lon IS 'District centroid longitude (WGS84).';
COMMENT ON COLUMN bronze.districts.population IS 'District population (persons).';
COMMENT ON COLUMN bronze.districts.urbanity IS 'Urbanity index from 0 (rural) to 1 (urban).';
COMMENT ON COLUMN bronze.districts.fp_unmet_pct IS 'NFHS-5 family planning unmet need (%).';
COMMENT ON COLUMN bronze.districts.institutional_birth_pct IS 'NFHS-5 institutional delivery rate (%).';
COMMENT ON COLUMN bronze.districts.csection_pct IS 'NFHS-5 caesarean section rate (%).';
COMMENT ON COLUMN bronze.districts.anaemia_pct IS 'NFHS-5 anaemia prevalence among women (%).';

COMMENT ON TABLE bronze.facilities_virtue IS
  'Bronze geotagged healthcare facilities from Virtue Foundation. One row per facility. Feeds silver_facilities.';

COMMENT ON COLUMN bronze.facilities_virtue.facility_id IS 'Stable facility primary key (e.g. VF-000123).';
COMMENT ON COLUMN bronze.facilities_virtue.name IS 'Facility name.';
COMMENT ON COLUMN bronze.facilities_virtue.type IS 'Facility type (District Hospital, Private Hospital, etc.).';
COMMENT ON COLUMN bronze.facilities_virtue.district IS 'District where the facility is located.';
COMMENT ON COLUMN bronze.facilities_virtue.state IS 'State name.';
COMMENT ON COLUMN bronze.facilities_virtue.lat IS 'Facility latitude (WGS84).';
COMMENT ON COLUMN bronze.facilities_virtue.lon IS 'Facility longitude (WGS84).';
COMMENT ON COLUMN bronze.facilities_virtue.beds IS 'Reported inpatient bed count.';
COMMENT ON COLUMN bronze.facilities_virtue.annual_surgeries IS 'Reported annual surgical volume.';
COMMENT ON COLUMN bronze.facilities_virtue.offers_surgery IS 'True when surgical services are offered.';
COMMENT ON COLUMN bronze.facilities_virtue.specialties IS 'Pipe-delimited list of clinical specialties.';
COMMENT ON COLUMN bronze.facilities_virtue.website_url IS 'Official facility website URL.';
COMMENT ON COLUMN bronze.facilities_virtue.match_confidence IS 'Entity-resolution confidence score (0–1).';

COMMENT ON TABLE bronze.facility_capability_assessments_virtue IS
  'Bronze Virtue Foundation per-facility capability trust assessments. One row per (facility, capability).';

COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.facility_id IS 'Foreign key to bronze.facilities_virtue.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.capability IS 'Capability code (icu, maternity, etc.).';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.capability_label IS 'Human-readable capability name.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.capability_description IS 'Clinical definition of the capability.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.claimed IS 'True when the source claims this capability.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.trust_signal IS 'Source trust signal (strong, partial, weak_suspicious, no_claim).';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.trust_score IS 'Source trust score (0–1).';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.evidence_count IS 'Total evidence items in source assessment.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.supporting_count IS 'Supporting evidence count.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.contradicting_count IS 'Contradicting evidence count.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.best_source IS 'Best evidence source label from Virtue export.';
COMMENT ON COLUMN bronze.facility_capability_assessments_virtue.summary IS 'One-sentence source summary.';

COMMENT ON TABLE bronze.facility_web_crawl IS
  'Bronze raw website crawl payloads. One row per crawl attempt (append-only). Feeds silver_facility_web_crawl.';

COMMENT ON COLUMN bronze.facility_web_crawl.crawl_id IS 'sha256(website_url + crawled_at) — stable per attempt.';
COMMENT ON COLUMN bronze.facility_web_crawl.facility_id IS 'Provisional facility link (no FK; may be null).';
COMMENT ON COLUMN bronze.facility_web_crawl.name IS 'Facility name from crawl metadata.';
COMMENT ON COLUMN bronze.facility_web_crawl.website_url IS 'Requested website URL.';
COMMENT ON COLUMN bronze.facility_web_crawl.final_url IS 'Final URL after HTTP redirects.';
COMMENT ON COLUMN bronze.facility_web_crawl.crawled_at IS 'Crawl timestamp (UTC).';
COMMENT ON COLUMN bronze.facility_web_crawl.status IS 'Crawl outcome: ok | http_error | fetch_error.';
COMMENT ON COLUMN bronze.facility_web_crawl.http_status IS 'HTTP response status code.';
COMMENT ON COLUMN bronze.facility_web_crawl.content_type IS 'Response Content-Type header.';
COMMENT ON COLUMN bronze.facility_web_crawl.title IS 'HTML page title.';
COMMENT ON COLUMN bronze.facility_web_crawl.raw_html IS 'Verbatim HTML payload.';
COMMENT ON COLUMN bronze.facility_web_crawl.raw_text IS 'Boilerplate-stripped page text for evidence extraction.';
COMMENT ON COLUMN bronze.facility_web_crawl.error IS 'Error message when crawl failed.';

COMMENT ON TABLE bronze.facilities_jci IS
  'Bronze JCI-accredited organizations in India. External reference source (data_source=jci). Feeds silver_facilities_jci.';

COMMENT ON COLUMN bronze.facilities_jci.jci_org_id IS 'Stable org id: sha256(match_name + city + state)[:16].';
COMMENT ON COLUMN bronze.facilities_jci.jci_name IS 'Organization name as published by the source.';
COMMENT ON COLUMN bronze.facilities_jci.city IS 'City location.';
COMMENT ON COLUMN bronze.facilities_jci.state IS 'State location.';
COMMENT ON COLUMN bronze.facilities_jci.country IS 'Country (default India).';
COMMENT ON COLUMN bronze.facilities_jci.accreditation_program IS 'JCI accreditation programme.';
COMMENT ON COLUMN bronze.facilities_jci.accreditation_decision IS 'Portal decision (e.g. Accredited).';
COMMENT ON COLUMN bronze.facilities_jci.effective_date IS 'Accreditation effective date.';
COMMENT ON COLUMN bronze.facilities_jci.match_name IS 'Normalized name for entity resolution.';
COMMENT ON COLUMN bronze.facilities_jci.brand_key IS 'First two significant name tokens for brand matching.';
COMMENT ON COLUMN bronze.facilities_jci.website_url IS 'Official hospital homepage URL.';
COMMENT ON COLUMN bronze.facilities_jci.snapshot_dir IS 'Path to scraped homepage snapshot.';
COMMENT ON COLUMN bronze.facilities_jci.verified_on_portal IS 'True when spot-checked against official JCI directory.';
COMMENT ON COLUMN bronze.facilities_jci.source IS 'Aggregator the row was compiled from.';
COMMENT ON COLUMN bronze.facilities_jci.source_url IS 'URL of the source page.';
COMMENT ON COLUMN bronze.facilities_jci.data_source IS 'Provenance tag (always jci).';
COMMENT ON COLUMN bronze.facilities_jci.collected_at IS 'When this record was collected (UTC).';

COMMENT ON TABLE bronze.facilities_nabh IS
  'Bronze NABH accredited/certified/empanelled facilities. Official nabh.co register. Feeds silver_facilities_nabh.';

COMMENT ON COLUMN bronze.facilities_nabh.nabh_org_id IS 'Stable org id: sha256(match_name + city + state + ref)[:16].';
COMMENT ON COLUMN bronze.facilities_nabh.nabh_name IS 'Organization name from NABH directory.';
COMMENT ON COLUMN bronze.facilities_nabh.city IS 'City from NABH record.';
COMMENT ON COLUMN bronze.facilities_nabh.state IS 'State from NABH record.';
COMMENT ON COLUMN bronze.facilities_nabh.pincode IS 'Postal pincode.';
COMMENT ON COLUMN bronze.facilities_nabh.country IS 'Country (default India).';
COMMENT ON COLUMN bronze.facilities_nabh.accreditation_program IS 'NABH programme (Hospitals, SHCO, etc.).';
COMMENT ON COLUMN bronze.facilities_nabh.accreditation_status IS 'Accredited | Certified | Empaneled.';
COMMENT ON COLUMN bronze.facilities_nabh.reference_no IS 'NABH reference number.';
COMMENT ON COLUMN bronze.facilities_nabh.certificate_url IS 'Portal certificate-and-scope PDF URL.';
COMMENT ON COLUMN bronze.facilities_nabh.address IS 'Full address as published.';
COMMENT ON COLUMN bronze.facilities_nabh.match_name IS 'Normalized name for entity resolution.';
COMMENT ON COLUMN bronze.facilities_nabh.brand_key IS 'Brand key for fuzzy matching.';
COMMENT ON COLUMN bronze.facilities_nabh.website_url IS 'Official homepage URL.';
COMMENT ON COLUMN bronze.facilities_nabh.phone IS 'Contact phone.';
COMMENT ON COLUMN bronze.facilities_nabh.lat IS 'Directory-provided latitude.';
COMMENT ON COLUMN bronze.facilities_nabh.lng IS 'Directory-provided longitude.';
COMMENT ON COLUMN bronze.facilities_nabh.verified_on_portal IS 'True — sourced from official portal.';
COMMENT ON COLUMN bronze.facilities_nabh.source IS 'Source label.';
COMMENT ON COLUMN bronze.facilities_nabh.source_url IS 'Source URL.';
COMMENT ON COLUMN bronze.facilities_nabh.data_source IS 'Provenance tag (always nabh).';
COMMENT ON COLUMN bronze.facilities_nabh.collected_at IS 'When collected (UTC).';

COMMENT ON TABLE bronze.locations_medical_travel IS
  'Bronze medical value travel hospitals — international patient programs (data_source=mvt). Reference source for entity resolution.';

COMMENT ON COLUMN bronze.locations_medical_travel.mvt_id IS 'Source hospital id (e.g. H001). Primary key.';
COMMENT ON COLUMN bronze.locations_medical_travel.name IS 'Hospital name.';
COMMENT ON COLUMN bronze.locations_medical_travel.hospital_chain IS 'Hospital chain or group name.';
COMMENT ON COLUMN bronze.locations_medical_travel.city IS 'City location.';
COMMENT ON COLUMN bronze.locations_medical_travel.state IS 'State location.';
COMMENT ON COLUMN bronze.locations_medical_travel.tier IS 'Program tier ranking from MVT dataset.';
COMMENT ON COLUMN bronze.locations_medical_travel.international_patient_program IS 'full | partial international patient program.';
COMMENT ON COLUMN bronze.locations_medical_travel.specialties IS 'Pipe-delimited specialties.';
COMMENT ON COLUMN bronze.locations_medical_travel.countries_served IS 'Pipe-delimited countries served.';
COMMENT ON COLUMN bronze.locations_medical_travel.has_ipc IS 'True when an international patient centre exists.';
COMMENT ON COLUMN bronze.locations_medical_travel.accreditation IS 'Pipe-delimited accreditations (e.g. NABH|JCI).';
COMMENT ON COLUMN bronze.locations_medical_travel.avg_cost_index IS 'Cost index: low | medium | high.';
COMMENT ON COLUMN bronze.locations_medical_travel.beds IS 'Bed count.';
COMMENT ON COLUMN bronze.locations_medical_travel.established_year IS 'Year established.';
COMMENT ON COLUMN bronze.locations_medical_travel.international_patients_annually IS 'Annual international patient volume.';
COMMENT ON COLUMN bronze.locations_medical_travel.phone IS 'Contact phone.';
COMMENT ON COLUMN bronze.locations_medical_travel.email IS 'Contact email.';
COMMENT ON COLUMN bronze.locations_medical_travel.website_url IS 'Official website URL.';
COMMENT ON COLUMN bronze.locations_medical_travel.match_name IS 'Normalized name for entity resolution.';
COMMENT ON COLUMN bronze.locations_medical_travel.brand_key IS 'Brand key for fuzzy matching.';
COMMENT ON COLUMN bronze.locations_medical_travel.data_source IS 'Provenance tag (always mvt).';
COMMENT ON COLUMN bronze.locations_medical_travel.source_url IS 'Hugging Face MVT dataset URL.';
COMMENT ON COLUMN bronze.locations_medical_travel.collected_at IS 'When collected (UTC).';

COMMENT ON TABLE bronze.locations_nhpr IS
  'Bronze NHPR/HFR registered hospitals from nhpr.abdm.gov.in (data_source=nhpr). Reference with bed-capacity detail.';

COMMENT ON COLUMN bronze.locations_nhpr.nhpr_facility_id IS 'HFR facility id. Primary key.';
COMMENT ON COLUMN bronze.locations_nhpr.facility_name IS 'Registered facility name.';
COMMENT ON COLUMN bronze.locations_nhpr.facility_status IS 'Registration status on NHPR portal.';
COMMENT ON COLUMN bronze.locations_nhpr.facility_type IS 'Facility type label.';
COMMENT ON COLUMN bronze.locations_nhpr.facility_type_code IS 'Facility type code.';
COMMENT ON COLUMN bronze.locations_nhpr.ownership IS 'Ownership type label.';
COMMENT ON COLUMN bronze.locations_nhpr.ownership_code IS 'Ownership type code.';
COMMENT ON COLUMN bronze.locations_nhpr.system_of_medicine IS 'System of medicine (Allopathy, AYUSH, etc.).';
COMMENT ON COLUMN bronze.locations_nhpr.system_of_medicine_code IS 'System of medicine code.';
COMMENT ON COLUMN bronze.locations_nhpr.state_name IS 'State name.';
COMMENT ON COLUMN bronze.locations_nhpr.state_lgd_code IS 'LGD state code.';
COMMENT ON COLUMN bronze.locations_nhpr.district_name IS 'District name.';
COMMENT ON COLUMN bronze.locations_nhpr.district_lgd_code IS 'LGD district code.';
COMMENT ON COLUMN bronze.locations_nhpr.sub_district_name IS 'Sub-district name.';
COMMENT ON COLUMN bronze.locations_nhpr.sub_district_lgd_code IS 'LGD sub-district code.';
COMMENT ON COLUMN bronze.locations_nhpr.village_city_town_name IS 'Village, city, or town name.';
COMMENT ON COLUMN bronze.locations_nhpr.address IS 'Full address.';
COMMENT ON COLUMN bronze.locations_nhpr.pincode IS 'Postal pincode.';
COMMENT ON COLUMN bronze.locations_nhpr.latitude IS 'Registered latitude.';
COMMENT ON COLUMN bronze.locations_nhpr.longitude IS 'Registered longitude.';
COMMENT ON COLUMN bronze.locations_nhpr.website_url IS 'Facility website URL.';
COMMENT ON COLUMN bronze.locations_nhpr.phone IS 'Contact phone.';
COMMENT ON COLUMN bronze.locations_nhpr.email IS 'Contact email.';
COMMENT ON COLUMN bronze.locations_nhpr.total_beds IS 'Total registered bed count.';
COMMENT ON COLUMN bronze.locations_nhpr.ipd_beds_with_oxygen IS 'IPD beds with oxygen supply.';
COMMENT ON COLUMN bronze.locations_nhpr.ipd_beds_without_oxygen IS 'IPD beds without oxygen.';
COMMENT ON COLUMN bronze.locations_nhpr.icu_beds_with_ventilators IS 'ICU beds with ventilators.';
COMMENT ON COLUMN bronze.locations_nhpr.icu_beds_without_ventilators IS 'ICU beds without ventilators.';
COMMENT ON COLUMN bronze.locations_nhpr.hdu_beds_with_ventilators IS 'HDU beds with ventilators.';
COMMENT ON COLUMN bronze.locations_nhpr.hdu_beds_without_ventilators IS 'HDU beds without ventilators.';
COMMENT ON COLUMN bronze.locations_nhpr.hdu_beds_with_functional_ventilators IS 'HDU beds with functional ventilators.';
COMMENT ON COLUMN bronze.locations_nhpr.day_care_beds_with_oxygen IS 'Day-care beds with oxygen.';
COMMENT ON COLUMN bronze.locations_nhpr.day_care_beds_without_oxygen IS 'Day-care beds without oxygen.';
COMMENT ON COLUMN bronze.locations_nhpr.dental_chairs IS 'Dental chair count.';
COMMENT ON COLUMN bronze.locations_nhpr.total_ventilators IS 'Total ventilator count.';
COMMENT ON COLUMN bronze.locations_nhpr.specialities IS 'Pipe-delimited specialities from NHPR.';
COMMENT ON COLUMN bronze.locations_nhpr.imaging_services IS 'Pipe-delimited imaging services.';
COMMENT ON COLUMN bronze.locations_nhpr.diagnostic_services IS 'Pipe-delimited diagnostic services.';
COMMENT ON COLUMN bronze.locations_nhpr.match_name IS 'Normalized name for entity resolution.';
COMMENT ON COLUMN bronze.locations_nhpr.brand_key IS 'Brand key for fuzzy matching.';
COMMENT ON COLUMN bronze.locations_nhpr.detail_json IS 'Full facilityDetail API payload (JSON).';
COMMENT ON COLUMN bronze.locations_nhpr.search_json IS 'Full search API payload (JSON).';
COMMENT ON COLUMN bronze.locations_nhpr.verified_on_portal IS 'True — sourced from official NHPR portal.';
COMMENT ON COLUMN bronze.locations_nhpr.source IS 'Source label.';
COMMENT ON COLUMN bronze.locations_nhpr.source_url IS 'NHPR portal URL.';
COMMENT ON COLUMN bronze.locations_nhpr.data_source IS 'Provenance tag (always nhpr).';
COMMENT ON COLUMN bronze.locations_nhpr.collected_at IS 'When collected (UTC).';

COMMENT ON TABLE bronze.facilities_pmjay IS
  'Bronze PMJAY (Ayushman Bharat) empanelled hospitals from HEM portal (data_source=pmjay). Reference for entity resolution.';

COMMENT ON COLUMN bronze.facilities_pmjay.pmjay_org_id IS 'Stable org id: sha256(match_name + district + state + hecp_id)[:16].';
COMMENT ON COLUMN bronze.facilities_pmjay.pmjay_name IS 'Hospital name on PMJAY portal.';
COMMENT ON COLUMN bronze.facilities_pmjay.hecp_id IS 'PMJAY EHCP / hospital reference id.';
COMMENT ON COLUMN bronze.facilities_pmjay.hospital_type IS 'Public | Private (For Profit) | Private (Not For Profit).';
COMMENT ON COLUMN bronze.facilities_pmjay.district IS 'District name.';
COMMENT ON COLUMN bronze.facilities_pmjay.state IS 'State name.';
COMMENT ON COLUMN bronze.facilities_pmjay.pincode IS 'Postal pincode.';
COMMENT ON COLUMN bronze.facilities_pmjay.country IS 'Country (default India).';
COMMENT ON COLUMN bronze.facilities_pmjay.address IS 'Full address.';
COMMENT ON COLUMN bronze.facilities_pmjay.email IS 'Contact email.';
COMMENT ON COLUMN bronze.facilities_pmjay.phone IS 'Contact phone.';
COMMENT ON COLUMN bronze.facilities_pmjay.specialties IS 'Pipe-delimited empanelled specialties.';
COMMENT ON COLUMN bronze.facilities_pmjay.specialties_upgraded IS 'Pipe-delimited upgraded specialties.';
COMMENT ON COLUMN bronze.facilities_pmjay.empanelment_scheme IS 'AB-PMJAY or state-integrated scheme.';
COMMENT ON COLUMN bronze.facilities_pmjay.nabh_status IS 'NABH accreditation grade if published on portal.';
COMMENT ON COLUMN bronze.facilities_pmjay.bed_strength IS 'Empanelled bed strength.';
COMMENT ON COLUMN bronze.facilities_pmjay.lat IS 'Latitude from portal.';
COMMENT ON COLUMN bronze.facilities_pmjay.lng IS 'Longitude from portal.';
COMMENT ON COLUMN bronze.facilities_pmjay.pmjay_state_code IS 'Internal portal state id.';
COMMENT ON COLUMN bronze.facilities_pmjay.pmjay_district_code IS 'Internal portal district id.';
COMMENT ON COLUMN bronze.facilities_pmjay.match_name IS 'Normalized name for entity resolution.';
COMMENT ON COLUMN bronze.facilities_pmjay.brand_key IS 'Brand key for fuzzy matching.';
COMMENT ON COLUMN bronze.facilities_pmjay.verified_on_portal IS 'True — sourced from official HEM portal.';
COMMENT ON COLUMN bronze.facilities_pmjay.source IS 'Source label.';
COMMENT ON COLUMN bronze.facilities_pmjay.source_url IS 'HEM portal URL.';
COMMENT ON COLUMN bronze.facilities_pmjay.data_source IS 'Provenance tag (always pmjay).';
COMMENT ON COLUMN bronze.facilities_pmjay.collected_at IS 'When collected (UTC).';

COMMENT ON TABLE bronze.merge_candidates IS
  'Splink probabilistic duplicate-facility merge candidates for human review. Not auto-merged into gold.';

COMMENT ON COLUMN bronze.merge_candidates.candidate_id IS 'Stable candidate pair identifier. Primary key.';
COMMENT ON COLUMN bronze.merge_candidates.left_source IS 'Source system of the left record (e.g. virtue, nhpr).';
COMMENT ON COLUMN bronze.merge_candidates.left_id IS 'Left record identifier in its source.';
COMMENT ON COLUMN bronze.merge_candidates.left_name IS 'Left record display name.';
COMMENT ON COLUMN bronze.merge_candidates.right_source IS 'Source system of the right record.';
COMMENT ON COLUMN bronze.merge_candidates.right_id IS 'Right record identifier in its source.';
COMMENT ON COLUMN bronze.merge_candidates.right_name IS 'Right record display name.';
COMMENT ON COLUMN bronze.merge_candidates.match_probability IS 'Splink match probability (0–1).';
COMMENT ON COLUMN bronze.merge_candidates.match_weight IS 'Splink match weight score.';
COMMENT ON COLUMN bronze.merge_candidates.state IS 'Shared state when both records have geography.';
COMMENT ON COLUMN bronze.merge_candidates.district IS 'Shared district when both records have geography.';
COMMENT ON COLUMN bronze.merge_candidates.recommendation IS 'Planner recommendation (default review).';
COMMENT ON COLUMN bronze.merge_candidates.flag_reason IS 'Why this pair was flagged for review.';
COMMENT ON COLUMN bronze.merge_candidates.computed_at IS 'When the candidate was computed (UTC).';

-- ---------------------------------------------------------------------------
-- gold — LLM narration outputs (not built by dbt)
-- ---------------------------------------------------------------------------

COMMENT ON TABLE gold.capability_evidence_json IS
  'Layer 2 LLM narration: structured JSON assessment per (facility, capability). Scores come from gold.capability_scored; planner overrides in app.capability_overrides win.';

COMMENT ON COLUMN gold.capability_evidence_json.facility_id IS 'Foreign key to gold.facilities.';
COMMENT ON COLUMN gold.capability_evidence_json.facility_name IS 'Facility name (denormalized).';
COMMENT ON COLUMN gold.capability_evidence_json.capability IS 'Capability code.';
COMMENT ON COLUMN gold.capability_evidence_json.evidence_strength_score IS 'Frozen deterministic score from gold.capability_scored.';
COMMENT ON COLUMN gold.capability_evidence_json.evidence_tier IS 'Frozen tier: Strong | Moderate | Weak | Insufficient.';
COMMENT ON COLUMN gold.capability_evidence_json.assessment_json IS 'Full LLM assessment as JSON (includes review_recommended flag).';
COMMENT ON COLUMN gold.capability_evidence_json.model_endpoint IS 'Databricks model serving endpoint used for narration.';
COMMENT ON COLUMN gold.capability_evidence_json.narrated_at IS 'When narration was generated (UTC).';

COMMENT ON TABLE gold.capability_evidence_md IS
  'Layer 2 LLM narration: markdown assessment per (facility, capability). Same frozen scores as capability_evidence_json.';

COMMENT ON COLUMN gold.capability_evidence_md.facility_id IS 'Foreign key to gold.facilities.';
COMMENT ON COLUMN gold.capability_evidence_md.facility_name IS 'Facility name (denormalized).';
COMMENT ON COLUMN gold.capability_evidence_md.capability IS 'Capability code.';
COMMENT ON COLUMN gold.capability_evidence_md.evidence_strength_score IS 'Frozen deterministic score from gold.capability_scored.';
COMMENT ON COLUMN gold.capability_evidence_md.evidence_tier IS 'Frozen tier bucket.';
COMMENT ON COLUMN gold.capability_evidence_md.assessment_md IS 'Full LLM assessment as markdown prose.';
COMMENT ON COLUMN gold.capability_evidence_md.model_endpoint IS 'Model serving endpoint used.';
COMMENT ON COLUMN gold.capability_evidence_md.narrated_at IS 'When narration was generated (UTC).';

-- ---------------------------------------------------------------------------
-- app — planner human-in-the-loop overrides (Lakebase only in production)
-- ---------------------------------------------------------------------------

COMMENT ON TABLE app.capability_overrides IS
  'Planner human overrides of automated trust signals. Overrides clear human-review flags in the app. Join on (facility_id, capability).';

COMMENT ON COLUMN app.capability_overrides.id IS 'Auto-increment override row id. Primary key.';
COMMENT ON COLUMN app.capability_overrides.created_by IS 'Databricks username of the planner who saved the override.';
COMMENT ON COLUMN app.capability_overrides.facility_id IS 'Foreign key to gold.facilities.facility_id.';
COMMENT ON COLUMN app.capability_overrides.capability IS 'Capability code being overridden.';
COMMENT ON COLUMN app.capability_overrides.facility_name IS 'Facility name snapshot at override time.';
COMMENT ON COLUMN app.capability_overrides.original_signal IS 'Pipeline trust_signal before override.';
COMMENT ON COLUMN app.capability_overrides.override_signal IS 'Planner-confirmed trust signal after ground-truth review.';
COMMENT ON COLUMN app.capability_overrides.original_score IS 'Pipeline evidence_strength_score before override.';
COMMENT ON COLUMN app.capability_overrides.override_score IS 'Planner-assigned score after review.';
COMMENT ON COLUMN app.capability_overrides.note IS 'Planner notes from phone call or inspection.';
COMMENT ON COLUMN app.capability_overrides.created_at IS 'When the override was saved (UTC).';
