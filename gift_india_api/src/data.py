"""Dataset generation / loading for gift_india India.

For the hackathon demo we synthesize a realistic ~10K-record geotagged facility
dataset across real Indian districts. The generation is deterministic (fixed seed)
so the app is reproducible and runs with zero external dependencies.

To go live, replace `load_facilities()` / `load_districts()` with loaders for the
governed Virtue Foundation dataset; the rest of the app is agnostic to the source.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
FACILITIES_CSV = os.path.join(DATA_DIR, "facilities.csv")
DISTRICTS_CSV = os.path.join(DATA_DIR, "districts.csv")

SEED = 42
N_FACILITIES = 10_000

# Surgical specialties the navigator reasons about.
SPECIALTIES = [
    "Cataract / Ophthalmology",
    "General Surgery",
    "Obstetrics & Gynaecology",
    "Orthopaedics",
    "Cleft & Plastic",
    "ENT",
    "Paediatric Surgery",
    "Cardiac",
    "Urology",
    "Burns & Reconstruction",
]

FACILITY_TYPES = [
    ("Primary Health Centre", 0.42, 0.05),
    ("Community Health Centre", 0.24, 0.20),
    ("District Hospital", 0.14, 0.55),
    ("Private Hospital", 0.13, 0.45),
    ("Medical College Hospital", 0.04, 0.90),
    ("Charitable / Mission Hospital", 0.03, 0.35),
]

# Real Indian districts/cities: (district, state, lat, lon, population, urbanity 0-1)
# Coordinates approximate; populations in persons (district-ish scale).
DISTRICTS: list[tuple] = [
    ("Mumbai", "Maharashtra", 19.076, 72.877, 12_442_373, 0.98),
    ("Delhi", "Delhi", 28.704, 77.102, 16_787_941, 0.97),
    ("Bengaluru", "Karnataka", 12.972, 77.595, 9_621_551, 0.95),
    ("Hyderabad", "Telangana", 17.385, 78.487, 6_809_970, 0.94),
    ("Ahmedabad", "Gujarat", 23.023, 72.571, 5_577_940, 0.91),
    ("Chennai", "Tamil Nadu", 13.083, 80.270, 4_646_732, 0.96),
    ("Kolkata", "West Bengal", 22.573, 88.364, 4_496_694, 0.96),
    ("Pune", "Maharashtra", 18.520, 73.857, 3_124_458, 0.90),
    ("Jaipur", "Rajasthan", 26.912, 75.787, 3_073_350, 0.78),
    ("Lucknow", "Uttar Pradesh", 26.847, 80.946, 2_817_105, 0.66),
    ("Kanpur", "Uttar Pradesh", 26.449, 80.331, 2_765_348, 0.62),
    ("Nagpur", "Maharashtra", 21.146, 79.088, 2_405_421, 0.68),
    ("Patna", "Bihar", 25.594, 85.137, 1_684_222, 0.43),
    ("Indore", "Madhya Pradesh", 22.720, 75.857, 1_964_086, 0.74),
    ("Bhopal", "Madhya Pradesh", 23.260, 77.413, 1_798_218, 0.70),
    ("Ranchi", "Jharkhand", 23.344, 85.310, 1_073_440, 0.34),
    ("Raipur", "Chhattisgarh", 21.251, 81.630, 1_010_087, 0.31),
    ("Guwahati", "Assam", 26.144, 91.736, 957_352, 0.30),
    ("Bhubaneswar", "Odisha", 20.296, 85.825, 837_737, 0.36),
    ("Srinagar", "Jammu & Kashmir", 34.084, 74.797, 1_180_570, 0.28),
    ("Varanasi", "Uttar Pradesh", 25.317, 82.973, 1_201_815, 0.40),
    ("Gorakhpur", "Uttar Pradesh", 26.760, 83.374, 673_446, 0.22),
    ("Muzaffarpur", "Bihar", 26.120, 85.364, 393_724, 0.14),
    ("Gaya", "Bihar", 24.796, 84.999, 470_839, 0.16),
    ("Jodhpur", "Rajasthan", 26.238, 73.024, 1_033_918, 0.41),
    ("Bikaner", "Rajasthan", 28.022, 73.312, 644_406, 0.20),
    ("Jaisalmer", "Rajasthan", 26.915, 70.908, 65_471, 0.07),
    ("Barmer", "Rajasthan", 25.751, 71.418, 83_517, 0.06),
    ("Koraput", "Odisha", 18.812, 82.712, 39_485, 0.05),
    ("Malkangiri", "Odisha", 18.347, 81.888, 25_590, 0.04),
    ("Bastar", "Chhattisgarh", 19.107, 81.954, 56_181, 0.05),
    ("Dantewada", "Chhattisgarh", 18.899, 81.355, 19_865, 0.03),
    ("Kalahandi", "Odisha", 19.914, 83.165, 30_172, 0.04),
    ("Sheopur", "Madhya Pradesh", 25.667, 76.696, 64_359, 0.06),
    ("Barwani", "Madhya Pradesh", 22.030, 74.901, 56_220, 0.06),
    ("Kishanganj", "Bihar", 26.097, 87.945, 105_782, 0.08),
    ("Sitamarhi", "Bihar", 26.595, 85.490, 56_490, 0.05),
    ("Nuh (Mewat)", "Haryana", 28.107, 77.001, 75_088, 0.07),
    ("Banswara", "Rajasthan", 23.546, 74.443, 101_017, 0.09),
    ("Dungarpur", "Rajasthan", 23.843, 73.714, 51_564, 0.05),
    ("Lahaul-Spiti", "Himachal Pradesh", 32.578, 77.358, 12_017, 0.03),
    ("Kargil", "Ladakh", 34.557, 76.126, 16_338, 0.04),
    ("Leh", "Ladakh", 34.164, 77.584, 30_870, 0.07),
    ("Tawang", "Arunachal Pradesh", 27.586, 91.859, 11_202, 0.04),
    ("Dibang Valley", "Arunachal Pradesh", 28.700, 95.900, 8_004, 0.02),
    ("Kohima", "Nagaland", 25.671, 94.110, 99_039, 0.13),
    ("Churachandpur", "Manipur", 24.333, 93.683, 38_415, 0.06),
    ("Wayanad", "Kerala", 11.605, 76.083, 145_184, 0.18),
    ("Gadchiroli", "Maharashtra", 20.181, 80.003, 41_829, 0.05),
    ("Nandurbar", "Maharashtra", 21.366, 74.241, 92_335, 0.08),
]


@dataclass(frozen=True)
class DataBundle:
    facilities: pd.DataFrame
    districts: pd.DataFrame


def _district_frame() -> pd.DataFrame:
    df = pd.DataFrame(
        DISTRICTS,
        columns=["district", "state", "lat", "lon", "population", "urbanity"],
    )
    return df


def _generate_facilities(districts: pd.DataFrame) -> pd.DataFrame:
    rng = np.random.default_rng(SEED)

    # More facilities where population is larger (with diminishing returns).
    weights = np.sqrt(districts["population"].to_numpy()) * (
        0.3 + districts["urbanity"].to_numpy()
    )
    probs = weights / weights.sum()
    counts = rng.multinomial(N_FACILITIES, probs)

    type_names = [t[0] for t in FACILITY_TYPES]
    type_probs = np.array([t[1] for t in FACILITY_TYPES])
    type_probs = type_probs / type_probs.sum()
    type_surgical = {t[0]: t[2] for t in FACILITY_TYPES}

    rows = []
    fid = 0
    for (_, drow), n in zip(districts.iterrows(), counts):
        urb = float(drow["urbanity"])
        for _ in range(int(n)):
            ftype = rng.choice(type_names, p=type_probs)
            # Scatter around the district centroid; rural facilities scatter wider.
            spread = 0.12 + (1.0 - urb) * 0.55
            lat = float(drow["lat"]) + rng.normal(0, spread)
            lon = float(drow["lon"]) + rng.normal(0, spread)

            # Does this facility offer any surgery at all?
            base_surg = type_surgical[ftype] * (0.55 + 0.45 * urb)
            offers_surgery = rng.random() < base_surg

            if offers_surgery:
                # Urban / larger facilities cover more specialties.
                k = 1 + rng.binomial(len(SPECIALTIES) - 1, 0.12 + 0.45 * urb)
                offered = list(
                    rng.choice(SPECIALTIES, size=min(k, len(SPECIALTIES)), replace=False)
                )
                beds = int(rng.integers(20, 1200) * (0.4 + urb))
                annual_surgeries = int(rng.integers(50, 6000) * (0.3 + urb))
            else:
                offered = []
                beds = int(rng.integers(2, 60))
                annual_surgeries = 0

            # Named-entity-resolution confidence score (governed-data realism).
            confidence = round(float(np.clip(rng.normal(0.86, 0.1), 0.4, 0.999)), 3)

            rows.append(
                {
                    "facility_id": f"VF-{fid:06d}",
                    "name": f"{drow['district']} {ftype.split()[0]} #{fid % 97}",
                    "type": ftype,
                    "district": drow["district"],
                    "state": drow["state"],
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "beds": beds,
                    "annual_surgeries": annual_surgeries,
                    "offers_surgery": offers_surgery,
                    "specialties": "|".join(offered),
                    # Synthetic facilities have no real website; left empty so the
                    # scraper skips them. Populate from the governed dataset to scrape.
                    "website_url": "",
                    "match_confidence": confidence,
                }
            )
            fid += 1

    return pd.DataFrame(rows)


def build_dataset(force: bool = False) -> DataBundle:
    """Generate the dataset (cached to CSV) and return it."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not force and os.path.exists(FACILITIES_CSV) and os.path.exists(DISTRICTS_CSV):
        return DataBundle(
            facilities=pd.read_csv(FACILITIES_CSV),
            districts=pd.read_csv(DISTRICTS_CSV),
        )

    districts = _district_frame()
    facilities = _generate_facilities(districts)
    facilities.to_csv(FACILITIES_CSV, index=False)
    districts.to_csv(DISTRICTS_CSV, index=False)
    return DataBundle(facilities=facilities, districts=districts)


def _coerce_facilities(df: pd.DataFrame) -> pd.DataFrame:
    for col in ("lat", "lon", "match_confidence"):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
    if "annual_surgeries" in df:
        df["annual_surgeries"] = (
            pd.to_numeric(df["annual_surgeries"], errors="coerce")
            .fillna(0)
            .astype(int)
        )
    if "offers_surgery" in df:
        df["offers_surgery"] = df["offers_surgery"].astype(bool)
    if "specialties" in df:
        df["specialties"] = df["specialties"].fillna("").astype(str)
    if "website_url" in df:
        df["website_url"] = df["website_url"].fillna("").astype(str)
    return df


def _coerce_districts(df: pd.DataFrame) -> pd.DataFrame:
    for col in (
        "lat", "lon", "urbanity", "fp_unmet_pct",
        "institutional_birth_pct", "csection_pct", "anaemia_pct",
    ):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
    if "population" in df:
        df["population"] = (
            pd.to_numeric(df["population"], errors="coerce").fillna(0).astype(int)
        )
    return df


def _lakebase_connection():
    """Open a psycopg connection to Lakebase using platform-injected env vars."""
    import psycopg
    from databricks.sdk import WorkspaceClient

    token = (
        WorkspaceClient()
        .postgres.generate_database_credential(
            endpoint=os.environ["LAKEBASE_ENDPOINT"]
        )
        .token
    )
    return psycopg.connect(
        host=os.environ["PGHOST"],
        port=int(os.environ.get("PGPORT", "5432")),
        dbname=os.environ.get("PGDATABASE", "gift_india"),
        user=os.environ["PGUSER"],
        password=token,
        sslmode=os.environ.get("PGSSLMODE", "require"),
    )


def _read_sql(conn, sql: str) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


_FACILITIES_SQL = """
    SELECT facility_id, name, type, district, state, lat, lon,
           specialties, offers_surgery, annual_surgeries, website_url,
           match_confidence
    FROM public.facilities
"""
_DISTRICTS_SQL = """
    SELECT district, state, lat, lon, population, urbanity,
           fp_unmet_pct, institutional_birth_pct, csection_pct, anaemia_pct
    FROM public.districts
"""


def _read_bundle(conn) -> DataBundle:
    facilities = _read_sql(conn, _FACILITIES_SQL)
    districts = _read_sql(conn, _DISTRICTS_SQL)
    return DataBundle(
        facilities=_coerce_facilities(facilities),
        districts=_coerce_districts(districts),
    )


def load_from_lakebase() -> DataBundle:
    """Read the live, continuously-synced Virtue Foundation data from Lakebase."""
    conn = _lakebase_connection()
    try:
        return _read_bundle(conn)
    finally:
        conn.close()


def load_from_postgres(dsn: str, connect_timeout: int = 5) -> DataBundle:
    """Read the dataset from a plain Postgres DSN (e.g. local dev database).

    A short ``connect_timeout`` keeps a misconfigured/unreachable database from
    hanging the app — ``load_bundle`` falls back to the synthetic dataset.
    """
    import psycopg

    conn = psycopg.connect(dsn, connect_timeout=connect_timeout)
    try:
        return _read_bundle(conn)
    finally:
        conn.close()


def load_bundle() -> DataBundle:
    """Load the data bundle from the best available source.

    Order of preference:

    1. **Lakebase** — when running as a Databricks App with a Lakebase resource
       (``LAKEBASE_ENDPOINT`` + ``PGHOST`` injected), read the live synced data.
    2. **Local / generic Postgres** — when ``GIFT_INDIA_DB_URL`` (or ``PG*``) is set
       (e.g. the docker-compose dev database).
    3. **Synthetic CSV** — deterministic fallback so the demo always runs with
       zero external dependencies.
    """
    if os.environ.get("LAKEBASE_ENDPOINT") and os.environ.get("PGHOST"):
        return load_from_lakebase()

    from . import db

    dsn = db.database_url()
    if dsn:
        try:
            return load_from_postgres(dsn)
        except Exception as exc:  # noqa: BLE001 — resilient dev fallback
            print(
                f"[data] Could not load from the configured database ({exc}); "
                "falling back to the synthetic dataset."
            )
    return build_dataset(force=False)


if __name__ == "__main__":
    bundle = build_dataset(force=True)
    print(f"Facilities: {len(bundle.facilities):,}")
    print(f"Districts:  {len(bundle.districts):,}")
    surg = bundle.facilities["offers_surgery"].sum()
    print(f"Surgical facilities: {surg:,} ({surg / len(bundle.facilities):.0%})")
