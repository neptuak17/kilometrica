"""Every official source the engine knows (D71). Add a region's adapter here."""

from dpg_audit.sources.official.bc_parks import BcParks
from dpg_audit.sources.official.bc_recsites import BcRecreationSites
from dpg_audit.sources.official.parks_canada import ParksCanada

SOURCES = [BcRecreationSites(), BcParks(), ParksCanada()]
