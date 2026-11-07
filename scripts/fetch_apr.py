"""Download Orange County rows of HCD APR Table A2 once and save them to data/raw/apr_a2_oc.csv.

Source: data.ca.gov, "Housing Element Annual Progress Report (APR) Data by Jurisdiction and Year",
Table A2, resource fe505d9b-8c36-42ba-ba30-08bc4f34e022. Paged politely (5,000 rows per call).
Only project-level fields we aggregate are kept; street addresses are NOT saved.
"""
import csv, json, time, urllib.parse, urllib.request
from pathlib import Path

RESOURCE = "fe505d9b-8c36-42ba-ba30-08bc4f34e022"
FIELDS = ["JURIS_NAME", "YEAR", "APN", "PRIOR_APN", "JURS_TRACKING_ID", "UNIT_CAT", "TENURE",
          "ENT_APPROVE_DT1", "NO_ENTITLEMENTS", "BP_ISSUE_DT1", "NO_BUILDING_PERMITS",
          "CO_ISSUE_DT1", "NO_OTHER_FORMS_OF_READINESS", "FIN_ASSIST_NAME", "APPROVE_SB35",
          "BP_VLOW_INCOME_DR", "BP_LOW_INCOME_DR", "BP_MOD_INCOME_DR",
          "BP_VLOW_INCOME_NDR", "BP_LOW_INCOME_NDR", "BP_MOD_INCOME_NDR"]
OUT = Path(__file__).resolve().parent.parent / "data" / "raw" / "apr_a2_oc.csv"

def page(offset):
    q = {"resource_id": RESOURCE, "limit": 5000, "offset": offset,
         "filters": json.dumps({"CNTY_NAME": "Orange"}), "fields": ",".join(FIELDS)}
    url = "https://data.ca.gov/api/3/action/datastore_search?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)["result"]

rows, offset = [], 0
while True:
    res = page(offset)
    rows += res["records"]
    print(f"{len(rows)} / {res['total']}", flush=True)
    offset += 5000
    if offset >= res["total"]:
        break
    time.sleep(1)
with OUT.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
    w.writeheader(); w.writerows(rows)
print("saved", OUT, len(rows))
