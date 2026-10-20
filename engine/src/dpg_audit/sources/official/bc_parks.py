"""BC Parks: provincial-park campgrounds and their operating dates (BC Parks Data API).

The API names each campground and gives its dated operating periods, but no coordinates: only its park's centre and
area. So a record here has an `anchor` (the park) and enriches a campsite already found inside it under a matching
name, chiefly with its season (D71). Group-only campgrounds are left out.
"""

import math
from collections.abc import Callable
from datetime import date

import httpx

from dpg_audit.config import user_agent
from dpg_audit.sources.official import OfficialRecord, months_from_ranges
from dpg_audit.sources.official.bc_recsites import OGL_BC

API = "https://bcparks.api.gov.bc.ca/api"
PAGE = 100


def _within(a: date, b: date, year: int) -> tuple[date, date]:
    """A period moved into `year` month for month (a season stated for another year), cut at the year's end."""
    if b.year > a.year:
        b = date(a.year, 12, 31)

    def move(d: date) -> date:
        return d.replace(year=year, day=min(d.day, 28)) if (d.month, d.day) == (2, 29) else d.replace(year=year)

    return move(a), move(b)


def _pages(client: httpx.Client, path: str, params: dict) -> list[dict]:
    out, page = [], 1
    while True:
        resp = client.get(f"{API}/{path}", params={**params, "pagination[page]": page, "pagination[pageSize]": PAGE})
        resp.raise_for_status()
        body = resp.json()
        out += body["data"]
        if page >= body["meta"]["pagination"]["pageCount"]:
            return out
        page += 1


class BcParks:
    id = "bc-parks"
    title = "BC Parks: campgrounds and operating dates"
    url = "https://bcparks.api.gov.bc.ca/api"
    licence = OGL_BC
    attribution = "Contains information licensed under the Open Government Licence – British Columbia"
    area = (-139.1, 48.2, -114.0, 60.0)

    def download(self, season_year: int, log: Callable[[str], None]) -> list[OfficialRecord]:
        with httpx.Client(timeout=120, headers={"User-Agent": user_agent()}) as client:
            features = _pages(
                client,
                "park-features",
                {
                    "filters[isActive][$eq]": "true",
                    "populate[parkFeatureType][fields][0]": "parkFeatureType",
                    "populate[parkArea][fields][0]": "parkAreaName",
                    "populate[protectedArea][fields][0]": "protectedAreaName",
                    "populate[protectedArea][fields][1]": "latitude",
                    "populate[protectedArea][fields][2]": "longitude",
                    "populate[protectedArea][fields][3]": "totalArea",
                },
            )
            dates = _pages(
                client,
                "park-dates",
                {
                    "filters[parkDateType][dateType][$eq]": "Operation",
                    "filters[isActive][$eq]": "true",
                    "fields[0]": "startDate",
                    "fields[1]": "endDate",
                    "fields[2]": "operatingYear",
                    "populate[parkFeature][fields][0]": "featureId",
                },
            )
        by_feature: dict[str, dict[int, list[tuple[date, date]]]] = {}
        for d in dates:
            fid = (d.get("parkFeature") or {}).get("featureId")
            if not fid or not d.get("startDate") or not d.get("endDate"):
                continue
            year = int(d["operatingYear"])
            by_feature.setdefault(fid, {}).setdefault(year, []).append(
                (date.fromisoformat(d["startDate"]), date.fromisoformat(d["endDate"]))
            )
        out: list[OfficialRecord] = []
        for f in features:
            kind = ((f.get("parkFeatureType") or {}).get("parkFeatureType") or "").lower()
            park = f.get("protectedArea") or {}
            if "campground" not in kind or "group" in kind or park.get("latitude") is None:
                continue
            years = by_feature.get(f["featureId"], {})
            # The trip's year when published, else the latest: most parks repeat their season year to year.
            year = season_year if season_year in years else max(years, default=None)
            months = None
            if year is not None:
                months = months_from_ranges([_within(a, b, year) for a, b in years[year]], year)
            area_name = (f.get("parkArea") or {}).get("parkAreaName")
            name = area_name or park["protectedAreaName"]
            if f.get("parkFeatureName") and f["parkFeatureName"] != "All sites":
                name = f"{name}: {f['parkFeatureName']}"
            radius = max(3000.0, math.sqrt(float(park.get("totalArea") or 0) * 10_000 / math.pi) * 1.2)
            out.append(
                OfficialRecord(
                    source=self.id,
                    id=f["featureId"],
                    name=name,
                    anchor=(float(park["longitude"]), float(park["latitude"]), round(radius)),
                    months=months,
                    label="BC Parks campground",
                    operator="BC Parks",
                    sites=int(f["frontcountrySites"]) if str(f.get("frontcountrySites") or "").isdigit() else None,
                    detail={"park": park["protectedAreaName"], "season_of": year},
                )
            )
        log(f"  {len(out):,} park campgrounds, {sum(r.months is not None for r in out):,} with operating dates")
        return out
