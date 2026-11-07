"""APR Table A2 rows (Orange County) -> data/city_timelines.json.

Metric: months from ENTITLEMENT approval to BUILDING PERMIT issued, per project, median per city.
Gotcha handled: each date is only filled in the year it happened, so one project spans several
yearly rows. We join rows by (city, JURS_TRACKING_ID) and fall back to (city, APN).
Excludes ADUs (our user builds 4-12 for-sale homes). Only aggregates are published, never rows.
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "raw" / "apr_a2_oc.csv"
OUT = ROOT / "data" / "city_timelines.json"
MIN_N = 5
CHECKED = "2026-11-07"
SOURCE = ("HCD Housing Element Annual Progress Report (APR) Table A2 via data.ca.gov, resource "
          "fe505d9b-8c36-42ba-ba30-08bc4f34e022 (dataset modified 2026-10-30)")

df = pd.read_csv(SRC, dtype=str)
df = df[~df["UNIT_CAT"].fillna("").str.upper().str.contains("ADU")]
for c in ("ENT_APPROVE_DT1", "BP_ISSUE_DT1", "CO_ISSUE_DT1"):
    df[c] = pd.to_datetime(df[c], errors="coerce")


def key(r):
    t = (r["JURS_TRACKING_ID"] or "").strip()
    if t and t.lower() not in ("0", "n/a", "na", "none", "-"):
        return "T:" + t
    a = (r["APN"] or "").strip()
    return "A:" + a if a and a.lower() not in ("0", "n/a", "na") else None


df = df.fillna({"JURS_TRACKING_ID": "", "APN": ""})
df["key"] = df.apply(key, axis=1)
df = df[df["key"].notna()]
g = df.groupby(["JURIS_NAME", "key"]).agg(
    ent=("ENT_APPROVE_DT1", "min"), bp=("BP_ISSUE_DT1", "min"), co=("CO_ISSUE_DT1", "min"),
    tenure=("TENURE", "first"), unit_cat=("UNIT_CAT", "first"))
g = g.reset_index()
g["ent_to_bp"] = (g["bp"] - g["ent"]).dt.days / 30.44
g["bp_to_co"] = (g["co"] - g["bp"]).dt.days / 30.44
both = g[(g["ent_to_bp"] >= 0) & (g["ent_to_bp"] < 120)]
ok = both[both["ent_to_bp"] > 0.5]  # same-day = by-right or reporting style; reported separately
okb = g[(g["bp_to_co"] >= 0) & (g["bp_to_co"] < 120)]

rows = []
for city in sorted(df["JURIS_NAME"].unique()):
    c_all = ok[ok["JURIS_NAME"] == city]
    c_own = c_all[c_all["tenure"].str.lower().str.startswith("o", na=False)]
    use, tenure = (c_own, "owner") if len(c_own) >= MIN_N else (c_all, "all")
    sd = both[(both["JURIS_NAME"] == city) & (both["ent_to_bp"] <= 0.5)]
    b = okb[okb["JURIS_NAME"] == city]
    rows.append({
        "city": city.title(),
        "median_months_entitlement_to_permit": round(float(use["ent_to_bp"].median()), 1) if len(use) >= MIN_N else None,
        "n_projects": int(len(use)),
        "n_same_day_entitlement_and_permit": int(len(sd)),
        "tenure": tenure,
        "median_months_permit_to_occupancy": round(float(b["bp_to_co"].median()), 1) if len(b) >= MIN_N else None,
        "n_projects_build": int(len(b)),
        "method": f"APR cross-year join on tracking ID/APN; non-ADU; projects with a separate entitlement step (>0 days); median; 'unknown' if n < {MIN_N}",
        "source": SOURCE,
        "label": "SOURCED" if len(use) >= MIN_N else "UNKNOWN",
        "checked": CHECKED,
    })
OUT.write_text(json.dumps({"min_projects": MIN_N, "cities": rows}, indent=1))

# Which funding programs real OC projects reported (aggregate counts only)
fa = df[["JURIS_NAME", "key", "FIN_ASSIST_NAME"]].dropna().drop_duplicates(["JURIS_NAME", "key"])
fa = fa[~fa["FIN_ASSIST_NAME"].str.strip().isin(["", "0", "None", "N/A", "n/a"])]
progs = (fa.assign(p=fa["FIN_ASSIST_NAME"].str.split(r"[;,]")).explode("p")
         .assign(p=lambda d: d["p"].str.strip()).query("p != ''"))
counts = progs.groupby("p")["key"].nunique().sort_values(ascending=False)
(ROOT / "data" / "oc_financing_used.json").write_text(json.dumps({
    "about": "Financial assistance programs named in APR Table A2 for Orange County projects (non-ADU), "
             "count of distinct projects. Self-reported by cities; names are as entered.",
    "source": SOURCE, "checked": CHECKED,
    "programs": [{"name": k, "projects": int(v)} for k, v in counts.head(25).items()]}, indent=1))

known = [r for r in rows if r["label"] == "SOURCED"]
print(f"{len(rows)} cities, {len(known)} with >= {MIN_N} projects")
for r in sorted(rows, key=lambda r: -r["n_projects"]):
    print(r["city"], r["median_months_entitlement_to_permit"], r["n_projects"], r["tenure"], "sameday", r["n_same_day_entitlement_and_permit"], "| build", r["median_months_permit_to_occupancy"])
print(counts.head(15))
