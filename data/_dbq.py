#!/usr/bin/env python3
"""Tiny throwaway helper: run a .sql file on the VF warehouse, print a table.

Usage: python3 data/_dbq.py path/to/query.sql
Reads profile/warehouse from env (PROFILE, WAREHOUSE).
"""
import json
import os
import subprocess
import sys

PROFILE = os.environ.get("PROFILE", "gift-india-mb")
WAREHOUSE = os.environ.get("WAREHOUSE", "234ccf680e359443")

sql = open(sys.argv[1]).read()
payload = {
    "warehouse_id": WAREHOUSE,
    "wait_timeout": "50s",
    "statement": sql,
}
out = subprocess.run(
    ["databricks", "api", "post", "/api/2.0/sql/statements", "-p", PROFILE,
     "--json", json.dumps(payload)],
    capture_output=True, text=True,
)
if out.returncode != 0:
    print("CLI ERROR:", out.stderr[:500])
    sys.exit(1)
d = json.loads(out.stdout)
st = d.get("status", {})
if st.get("state") != "SUCCEEDED":
    print("SQL STATE:", json.dumps(st)[:600])
    sys.exit(1)
cols = [c["name"] for c in d.get("manifest", {}).get("schema", {}).get("columns", [])]
rows = d.get("result", {}).get("data_array", [])
print(" | ".join(cols))
print("-" * 80)
for r in rows:
    print(" | ".join("" if x is None else str(x)[:55] for x in r))
print(f"\n({len(rows)} rows)")
