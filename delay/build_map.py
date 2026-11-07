"""Build data/oc_map.json: Orange County city outlines as SVG paths.

Source: County of Orange, OC Public Works GIS, "City Boundaries Coastline" layer
https://www.ocgis.com/arcpub/rest/services/Map_Layers/City_Boundaries_Coastline/MapServer/0
Downloaded once, simplified on the server (maxAllowableOffset 0.0012 degrees).

Run: python delay/build_map.py           (uses raw/oc_cities_raw.json if present)
"""
import json
import math
import os
import urllib.parse
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw", "oc_cities_raw.json")
OUT = os.path.join(ROOT, "data", "oc_map.json")
URL = "https://www.ocgis.com/arcpub/rest/services/Map_Layers/City_Boundaries_Coastline/MapServer/0/query"
W = 1000

if not os.path.exists(RAW):
    q = urllib.parse.urlencode({"where": "1=1", "outFields": "CITY,JURISDICTI,Acres", "returnGeometry": "true",
                                "outSR": "4326", "maxAllowableOffset": "0.0012", "geometryPrecision": "5", "f": "json"})
    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    open(RAW, "wb").write(urllib.request.urlopen(URL + "?" + q, timeout=120).read())

feats = json.load(open(RAW))["features"]
pts = [p for f in feats for ring in f["geometry"]["rings"] for p in ring]
lon0, lon1 = min(p[0] for p in pts), max(p[0] for p in pts)
lat0, lat1 = min(p[1] for p in pts), max(p[1] for p in pts)
k = math.cos(math.radians((lat0 + lat1) / 2))
sx = W / ((lon1 - lon0) * k)
H = round((lat1 - lat0) * sx)


def xy(p):
    return ((p[0] - lon0) * k * sx, (lat1 - p[1]) * sx)


groups = defaultdict(lambda: {"d": [], "area": 0.0, "cx": 0.0, "cy": 0.0})
for f in feats:
    name = f["attributes"]["CITY"].strip().upper()
    juris = name if name not in ("UNINCORPORATED", "BOLSA CHICA", "4-OR-16") else "ORANGE COUNTY"
    g = groups[juris]
    for ring in f["geometry"]["rings"]:
        q = [xy(p) for p in ring]
        g["d"].append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in q) + "Z")
        a = 0.0
        cx = cy = 0.0
        for (x1, y1), (x2, y2) in zip(q, q[1:] + q[:1]):
            c = x1 * y2 - x2 * y1
            a += c
            cx += (x1 + x2) * c
            cy += (y1 + y2) * c
        if abs(a) > 1e-9:
            g["area"] += abs(a) / 2
            g["cx"] += cx / (3 * a) * abs(a) / 2
            g["cy"] += cy / (3 * a) * abs(a) / 2

cities = []
for juris, g in groups.items():
    cities.append({"juris": juris, "d": "".join(g["d"]), "cx": round(g["cx"] / g["area"], 1), "cy": round(g["cy"] / g["area"], 1), "area": round(g["area"])})
cities.sort(key=lambda c: -c["area"])

json.dump({"source": "County of Orange, OC Public Works GIS, City Boundaries Coastline", "source_url": URL.rsplit("/query", 1)[0],
           "checked": "2026-11-07", "viewBox": [0, 0, W, H], "cities": cities}, open(OUT, "w"))
print(f"wrote {OUT}: {len(cities)} shapes, viewBox 0 0 {W} {H}, {os.path.getsize(OUT)//1024} KB")
