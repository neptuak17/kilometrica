# Official accommodation registers: a scan of Europe and North America

Scanned 2026-10-19 for M4.5 (D58). We want to know, country by country, whether there's an official register of licensed hotels, campsites and hostels we can use. That means one that is published as open data, under a licence we can use, and that says when each place is open.

**How sure each line is:** "**Opened**" means we downloaded the file or called the service and read its columns and counts. "Reported" means a search result or catalogue page said so and we didn't open the data. Everything reported needs checking before we build on it.

## What we found, in short

- **Hardly any register says when a place is open.** Only Québec does it for everything: each establishment is marked year-round or seasonal, and seasonal ones carry dates. In Europe:
  - Portugal records closures for only a handful of hotels;
  - Valencia gives campsites a rough period;
  - France's registers carry none in their downloadable files.
- **Registers are good at three other things:**
  - showing that a place exists and is licensed;
  - giving its website, phone and address;
  - in some (Catalonia, Valencia), saying it has been struck off.
- **Most of Southern Europe has regional registers.** France and Portugal have national ones; Spain and Italy have them by region. Further north most countries have none: Germany, Austria, Switzerland, the Netherlands, England and the Nordics. Riders there stay on "check first".
- **Several registers name private owners,** sometimes with their tax numbers and emails (Catalonia, Portugal, Ireland). We'd keep only the establishment's own details and never import people's names.
- **The EU's short-term rental rules** (Regulation 2024/1028, in force since 20 May 2026) don't create public registers. Platforms must show each listing's registration number and send activity data to the authorities. That's of little use to us.

## By country

### Southern Europe (EV8 runs through most of these)

| Country | Register | Open data? | Seasons? | Location | Licence | Status |
|---|---|---|---|---|---|---|
| **France** | Atout France, the classified establishments (hotels, campsites, holiday villages, tourist residences, hostels). Classification is voluntary, so unclassified places are missing. | Yes: one CSV, updated daily ([data.gouv.fr](https://www.data.gouv.fr/datasets/hebergements-collectifs-classes-en-france/)) | No | Address, postcode and commune; **no coordinates** | Licence Ouverte 2.0 | **Opened:** 21,371 rows, including 5,675 campsites and 118 hostels. It gives each place's website and capacity. |
| France | DATAtourisme: tourist offices' listings, a marketing database rather than a register | Yes: daily CSV by region; full RDF export (1.9 GB); API with a free key ([data.gouv.fr](https://www.data.gouv.fr/datasets/datatourisme-la-base-nationale-des-donnees-publiques-dinformation-touristique-en-open-data)) | **Not in the CSVs.** The ontology has opening periods; whether the full export fills them is not checked | Coordinates | Licence Ouverte 2.0 | **Opened (CSV):** PACA has 6,539 accommodation rows and Occitanie 19,551. Not one fills the periods column. Most rows were updated within the year, and official stars appear under "Classements". |
| **Spain: Catalonia** | Registre de Turisme de Catalunya: hotels, campsites, apartments, rural tourism, motorhome areas ([datos.gob.es](https://datos.gob.es/es/catalogo/a09002970-establecimientos-de-alojamiento-turistico-inscritos-en-el-registro-de-turismo-de-catalunya)) | Yes: CSV, JSON or XML, monthly | No | Street address; **no coordinates** | Generalitat open licence (**verify** terms) | **Opened.** It gives status (active or struck off), category and number of places. It also names private owners. |
| Spain: Valencia | Registre de Turisme: campsites, hotels, hostels, rural houses, motorhome areas ([dadesobertes.gva.es](https://dadesobertes.gva.es/dataset/tur-gestur-ca)) | Yes: CSV per type | **Rough, campsites only**: of 161, 140 say "all year", 17 "not specified", 2 Easter and 2 summer | Address; **no coordinates** | CC BY | **Opened** (campsites). It gives status and category. |
| Spain: Galicia | REAT ([datos.gob.es](https://datos.gob.es/es/catalogo/a12002994-registro-de-empresas-y-actividades-turisticas)) | Reported, monthly | Unknown | Unknown | Unknown | Reported |
| Spain: Andalucía, Murcia, Basque Country, Asturias, Cantabria | Registers exist by law; Andalucía's is public and free to consult | No open download found | – | – | – | Not found: **verify** on each region's portal |
| **Portugal** | RNET (hotels, rural tourism, campsites) and RNAL (local lodging), both run by Turismo de Portugal | Yes: a JSON web service by municipality ([an example](https://webservices.turismodeportugal.pt/RNT_External/rest/RNT/list_RNET?Concelho=Faro)). The copies on dados.gov.pt stopped in 2020. | **Closures, rarely:** dated closures for 1 of 32 places in Faro, 2 of 73 in Lagos and 0 of 216 in Porto | Address and postcode; **no coordinates** | Lisbon's catalogue lists it as CC0; the service states no terms (**verify**) | **Opened.** It gives category, capacity, phone and email. It names the operating company and its tax number. |
| **Italy** | National: BDSR, where every establishment gets a CIN code (690,000 registered) | Aggregate counts on dati.gov.it; **no per-place list confirmed**. Single CINs can be checked online. | Unknown | – | – | Reported. OSM already has a `ref:cin` tag, which would make matching easy. |
| Italy: regions | Puglia (CSV with coordinates and contacts, IODL 2.0); Veneto (ROSS1000, updated daily); Umbria (stops in 2016); Tuscany (counts only). **Liguria:** the law lets the region publish its list, but none was found. | Some | Unknown | Puglia has coordinates | IODL 2.0 (Puglia) | Reported. Liguria matters to us: EV8 and our test route end there. |
| **Slovenia** | AJPES register of accommodation (all types, including private rooms and mountain huts) | A public lookup and a list "as of a date" are reported; format not confirmed | No (it covers type, category and capacity) | Address | Unknown | Reported |
| **Croatia** | The Ministry's list of categorised establishments, updated several times a year; eVisitor behind it | Published as a web list or PDF, **not as open data** | No | – | – | Reported |
| Greece, Cyprus, Montenegro, Albania, Bosnia | Registers exist (Cyprus licenses hotels) | **None found as open data** | – | – | – | Not found |

### Northern and Central Europe

| Country | Register | Open data? | Seasons? | Notes |
|---|---|---|---|---|
| **Ireland** | Fáilte Ireland's register of approved accommodation ([data.gov.ie](https://data.gov.ie/dataset/national-quality-assurance-framework-register-of-accommodation)) | Yes: CSV and API | No | **Opened:** it has columns for coordinates, but they're empty in the rows we saw. It names owners. CC BY 4.0. |
| **Belgium: Flanders** | Toerisme Vlaanderen, under the accommodation decree: hotels, B&Bs, campsites, hostels and holiday homes, one file each ([catalogue](https://www.vlaanderen.be/datavindplaats/catalogus/hotels-via-poi-service-v2)) | Yes: CSV, GML or shapefile, monthly | Unknown | Reported, with location and contacts. The licence is unclear: the record says both "public" and "copyright". **Verify.** |
| **Poland** | Central list of hotel establishments (CWOH), about 3,500 categorised hotels | Reported on dane.gov.pl, and through an API at turystyka.gov.pl | Unknown | Reported. Categorised hotels only, so no campsites or hostels. |
| **Hungary** | NTAK (every provider must register) | Not public; only statistics are published | – | Not open |
| **Germany** | No register | – | – | The national tourist board's Knowledge Graph collects the regional boards' marketing data (about 100,000 places, hotels among them). The licence varies by source. Worth a later look, but it isn't a register. |
| **Austria, Switzerland, Netherlands** | No national register of establishments | Statistics only (Statistik Austria, the Swiss statistics office, CBS) | – | Switzerland has a regional marketing list for Eastern Switzerland. The hoteliers' database is closed. |
| **UK** | England and Wales: none. Scotland: each council licenses short-term lets and keeps a public register. | Some councils publish theirs | – | Short-term lets only |
| **Nordics** | None found | – | – | Not found |

### North America

| Country | Register | Open data? | Seasons? | Notes |
|---|---|---|---|---|
| **Canada: Québec** | SIT Québec: every establishment holding a registration certificate. Separate files for campsites, hotels, B&Bs (gîtes), hostels and cottages. ([Données Québec](https://www.donneesquebec.ca/recherche/dataset/sit-quebec-campings)) | Yes: CSV, JSON or XML, updated daily | **Yes, for every place.** Each is marked year-round or seasonal, seasonal ones have start and end dates, and it says when dates are estimated | **Opened:** 1,227 campsites (1,038 seasonal, all with dates), 1,904 hotels and 569 B&Bs, every one with coordinates. It even lists bike racks under services. CC BY 4.0. The model to aim for. |
| Canada: other provinces | Nova Scotia's listed operators; BC's short-term rental registry | Reported | Unknown | No other province has a full licensing register as open data |
| Canada: Parks Canada | Campground seasons, as web pages for each park | No | Text only | – |
| **USA** | No national register. States license lodging, usually through health or business departments. | Varies: Florida publishes every licensed hotel and motel as CSV under its public records law ([DBPR](https://www2.myfloridalicense.com/?p=11609)) | No | Every state differs |
| USA: federal campgrounds | RIDB / Recreation.gov (campgrounds of 12 federal agencies); the National Park Service API | API with a free key | NPS gives operating hours and seasons (**verify**); RIDB doesn't seem to | US government data, normally public domain (**verify**) |

## What it means for Plan and Go

- **Seasons:**
  - In Europe a register will rarely raise what we know about opening months enough to say more than "check first" (D57's 9-in-10 rule).
  - Québec is the exception. The second exception could be France, *if* DATAtourisme's full export fills its opening periods. That's the one check worth doing next.
- **Contacts:** where OSM has no website or phone for a place, a register often does. That makes "check first" easier: the rider gets a number to ring.
- **Existence:** a register adds licensed places that OSM lacks. Where it says a place has been struck off (Catalonia, Valencia) or has a dated closure (Portugal), we can say so.
  - A register is never complete: Catalonia says so itself, and France's classification is voluntary.
  - So a place missing from a register is never hidden.
- **Matching to our places:**
  - **With coordinates:** Québec, Puglia, Flanders and DATAtourisme match by distance and name.
  - **Without them:** France's Atout France list, Catalonia, Valencia and Portugal need name plus municipality, or geocoding the address. France has a free national address service for that, the Base Adresse Nationale.
  - Our audit keeps no OSM address tags yet. It would need to, to match by address.

## Sources not opened

Searches also turned up the following; each needs a look before use:
- Andalucía's Decree 143/2014 (its register is public);
- Italy's BDSR figures (694,287 places registered, 14 January 2026);
- Slovenia's rules for its register;
- Croatia's eVisitor;
- Scotland's short-term let guidance;
- the DZT Knowledge Graph;
- RIDB's field list.
