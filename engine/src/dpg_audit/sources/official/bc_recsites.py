"""BC Recreation Sites and Trails: recreation sites with defined campsites (BC Data Catalogue, "Recreation Polygons").

Recreation sites are unmanaged: no season at all, so none is ever mentioned (the owner, D71). Retired sites, recreation
reserves and interpretive forests are left out, and so are sites without defined campsites.
"""

from collections.abc import Callable

import httpx
from shapely.geometry import shape

from dpg_audit.config import user_agent
from dpg_audit.models import Licence
from dpg_audit.sources.official import NO_SEASON, OfficialRecord

WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs"
LAYER = "pub:WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW"
OGL_BC = Licence(
    id="OGL-BC-2.0",
    name="Open Government Licence – British Columbia",
    url="https://www2.gov.bc.ca/gov/content/data/policy-standards/open-data/open-government-licence-bc",
)
PAGE = 1000


class BcRecreationSites:
    id = "bc-recsites"
    title = "BC Recreation Sites and Trails: recreation sites"
    url = "https://catalogue.data.gov.bc.ca/dataset/recreation-polygons"
    licence = OGL_BC
    attribution = "Contains information licensed under the Open Government Licence – British Columbia"
    area = (-139.1, 48.2, -114.0, 60.0)

    def download(self, season_year: int, log: Callable[[str], None]) -> list[OfficialRecord]:
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeName": LAYER,
            "outputFormat": "json",
            "srsName": "EPSG:4326",
            "CQL_FILTER": "PROJECT_TYPE='Recreation Site' AND LIFE_CYCLE_STATUS_CODE='ACTIVE' AND DEFINED_CAMPSITES>0",
            "count": str(PAGE),
            "sortBy": "OBJECTID",  # paging needs an order: the layer has no primary key
        }
        out: list[OfficialRecord] = []
        with httpx.Client(timeout=120, headers={"User-Agent": user_agent()}) as client:
            start = 0
            while True:
                resp = client.get(WFS, params={**params, "startIndex": str(start)})
                resp.raise_for_status()
                features = resp.json().get("features", [])
                for f in features:
                    p = f["properties"]
                    c = shape(f["geometry"]).representative_point()
                    name = " ".join(w.capitalize() for w in (p.get("PROJECT_NAME") or "").split())
                    out.append(
                        OfficialRecord(
                            source=self.id,
                            id=p["FOREST_FILE_ID"],
                            name=f"{name} Recreation Site" if name else None,
                            lon=round(c.x, 6),
                            lat=round(c.y, 6),
                            months=NO_SEASON,
                            label="BC Recreation Site",
                            operator="Recreation Sites and Trails BC",
                            sites=int(p.get("DEFINED_CAMPSITES") or 0) or None,
                        )
                    )
                if len(features) < PAGE:
                    break
                start += PAGE
        log(f"  {len(out):,} recreation sites with campsites")
        return out
