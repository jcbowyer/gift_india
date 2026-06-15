# gift_india — dbt medallion pipeline

Transforms the governed **Virtue Foundation** dataset (read via Delta Sharing)
into a `bronze → silver → gold` medallion on Databricks, and ships as a
**Databricks Asset Bundle (DAB)** that runs dbt as a scheduled Job.

The first transformations focus on the four facility-capability columns the
source provides as JSON-array strings: **specialties, procedures, equipment,
and capabilities**.

## Layout

```
dbt_project/
├── databricks.yml                 # DAB: bundle, variables, dev/prod targets
├── resources/transform.job.yml    # DAB job: dbt task on serverless + SQL warehouse
├── dbt_project.yml                # dbt config (profile, per-layer schemas)
├── profiles.yml                   # local dbt profile (Databricks CLI auth)
├── packages.yml                   # dbt_utils
├── macros/
│   ├── generate_schema_name.sql   # clean per-layer schemas (no target prefix)
│   └── humanize_camel_case.sql    # "orthopedicSurgery" -> "Orthopedic Surgery"
└── models/
    ├── bronze/                    # land VF source verbatim (facilities, nfhs5, pincode)
    ├── silver/                    # conform facilities + explode the 4 capability arrays
    └── gold/                      # specialty/procedure/equipment/capability marts + profile
```

## Medallion

| Layer | Models | Purpose |
|-------|--------|---------|
| **bronze** | `bronze_facilities`, `bronze_nfhs5_district_indicators`, `bronze_india_post_pincode` | Land the Delta Sharing source verbatim, source-native types. |
| **silver** | `silver_facilities` + `silver_facility_specialties` / `_procedures` / `_equipment` / `_capabilities` | Conform the facility entity; parse the JSON-array capability columns and explode to one row per item. |
| **gold** | `gold_specialties`, `gold_procedures`, `gold_equipment`, `gold_capabilities`, `gold_facility_capability_profile` | Serving dimensions with coverage counts + a per-facility rollup. |

The medallion schemas land in the configured catalog as
`<catalog>.gift_india_bronze`, `_silver`, and `_gold` (catalog defaults to
`workspace` since the `gift_india` catalog is a Lakebase online catalog).

## Run it locally

```bash
cd dbt_project
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
dbt deps

# Auth uses the Databricks CLI profile; pick the workspace:
export DATABRICKS_CONFIG_PROFILE=gift-india
export GIFT_INDIA_CATALOG=workspace        # catalog for the medallion schemas

dbt build         # run + test the whole medallion
dbt build --select silver_facility_specialties+   # just specialties downstream
```

## Deploy + run as a DAB

```bash
cd dbt_project
databricks bundle validate -p gift-india
databricks bundle deploy -t dev -p gift-india
databricks bundle run gift_india_transform -t dev -p gift-india
```

`-t prod` deploys the production target. Override the catalog/warehouse with
`--var catalog=<cat>` / `--var warehouse_id=<id>` if needed.
