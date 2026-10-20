"""Parks Canada: campgrounds in national parks and historic sites ("Accommodation", Open Government Portal).

The layer lists each campsite (and oTENTik, yurt, cabin…) on its own; they are grouped by campground into one place.
Parks Canada says the layer may not be complete, and it publishes no seasons here, so those stay unknown.
"""

from collections.abc import Callable

import httpx

from dpg_audit.config import user_agent
from dpg_audit.models import Licence
from dpg_audit.sources.official import OfficialRecord

LAYER = (
    "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Accommodation_Hebergement_V2_FGP/"
    "FeatureServer/0/query"
)
PAGE = 2000
OGL_CANADA = Licence(
    id="OGL-Canada-2.0",
    name="Open Government Licence – Canada",
    url="https://open.canada.ca/en/open-government-licence-canada",
)
# Kinds a rider can book for a night; group-only camping and moorings are left out.
CAMPING = ("camping", "backcountry", "otentik", "tipi", "yurt", "oasis", "microcube", "cabin")


class ParksCanada:
    id = "parks-canada"
    title = "Parks Canada: campgrounds"
    url = "https://open.canada.ca/data/dataset/74054d44-68cf-41af-8919-5f09f80dcd02"
    licence = OGL_CANADA
    attribution = "Contains information licensed under the Open Government Licence – Canada"
    area = (-141.1, 41.6, -52.5, 83.2)

    def download(self, season_year: int, log: Callable[[str], None]) -> list[OfficialRecord]:
        sites: list[dict] = []
        with httpx.Client(timeout=120, headers={"User-Agent": user_agent()}) as client:
            offset = 0
            while True:
                resp = client.get(
                    LAYER,
                    params={
                        "where": "1=1",
                        "outFields": "Name_e,Accommodation_Type,URL_e",
                        "f": "geojson",
                        "resultOffset": offset,
                        "resultRecordCount": PAGE,
                    },
                )
                resp.raise_for_status()
                features = resp.json().get("features", [])
                sites += features
                if len(features) < PAGE:
                    break
                offset += PAGE
        groups: dict[str, list[dict]] = {}
        for f in sites:
            p = f["properties"]
            kind = (p.get("Accommodation_Type") or "").split("//")[0].lower()
            if not p.get("Name_e") or not f.get("geometry") or not any(k in kind for k in CAMPING) or "group" in kind:
                continue
            groups.setdefault(p["Name_e"], []).append(f)
        out = []
        for name, members in groups.items():
            xs = [m["geometry"]["coordinates"][0] for m in members]
            ys = [m["geometry"]["coordinates"][1] for m in members]
            urls = [str(m["properties"].get("URL_e") or "") for m in members]
            url = next((u for u in urls if u.startswith("http")), None)
            out.append(
                OfficialRecord(
                    source=self.id,
                    id=name,
                    name=name,
                    lon=round(sum(xs) / len(xs), 6),
                    lat=round(sum(ys) / len(ys), 6),
                    label="Parks Canada campground",
                    operator="Parks Canada",
                    sites=len(members),
                    detail={"website": url} if url else {},
                )
            )
        log(f"  {len(out):,} campgrounds from {len(sites):,} sites")
        return out
