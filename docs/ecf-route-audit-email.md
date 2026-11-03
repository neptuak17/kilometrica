# The route audit, for ECF

Text for an email to the European Cyclists' Federation (ECF) on how the route audit works and how it lines up with the EuroVelo European Certification Standard (ECS). Written 2026-11-03 and checked the same day against the 2026 ECS short manual; the figures come from the EV8 and EV15 audits of that day.

## Email text

Kilometrica's route audit was built to give riders planning a EuroVelo trip an honest picture of every stretch, and it is modelled on the European Certification Standard. It starts from the route's official GPX and development status, as published on EuroVelo.com under the ODbL, matches the track to OpenStreetMap, and measures everything along it: the kind of way and the traffic on it, the surface, the climbing (from the Copernicus elevation model), and the places to stay, eat, get a bike repaired, find a toilet or take a train or ferry with a bike. Each fact is placed at its kilometre with its source and date. Like ECS, the audit works in EuroVelo's own daily sections: each criterion is judged pass, fail or unknown kilometre by kilometre within them, and the results are added up for each daily section and for the whole route as the share of length that meets all the essential criteria and all the important ones, the way ECS certification reports summarise a route. Where the map data are too thin to judge, the audit says unknown rather than guessing. So far we have audited all of EuroVelo 8 and EuroVelo 15 along one bank of the Rhine, and the same audit runs on any route supplied as a GPX file.

The services and public-transport criteria follow the 2026 ECS short manual tier by tier: accommodation, food and water, and cycle repair on every daily section are essential; accommodation other than camping, a bike repair shop and toilets every 15 km are important; and a station where bikes can be taken on board is needed at least every 150 km (essential) or 75 km (important). The infrastructure criteria cover the same ground as ECS (continuity, traffic, surface, climbing and signing), but in an earlier, provisional form. Our next step is to bring them into line with the 2026 manual: its five traffic categories by speed and volume, its surface classes, cumulative climbing per daily section, and signing as an essential criterion. Alongside the criteria, the audit lists findings at their kilometre: busy roads by name, unpaved stretches, steps, steep climbs, long stretches with no station to bail out to, and each gap typed by the evidence for it (a ferry, an official public-transport link, or a missing link). It also reports data-quality findings that may be useful to ECF and the NECCs: straight-line placeholders in the GPX (one of 28 km on EuroVelo 8), breaks between sections, a section stored end to start, ridden lengths more than 10% off the published length, and daily sections where OpenStreetMap's EuroVelo route relation is missing or incomplete.

We see the audit as an indicative pre-assessment that sits alongside ECS surveys and certification, not in place of them: it works from open data rather than a field survey by EuroVelo Route Inspectors. A few criteria aren't checked yet, among them how often public transport runs, rest areas, attractions and noise, the signs on the ground, and the communication criteria. After aligning the infrastructure criteria, we would like to calibrate the audit against a published certification report, starting with the 2025 report for EuroVelo 15, and we would value ECF's view on both, and on which findings would help you and the National EuroVelo Coordination Centres most.

## Who to write to

- **The address:** eurovelo@ecf.com, the EuroVelo team's mailbox. The 2026 ECS short manual and ECF's ECS page give it for every ECS question, from licences to the methodology.
- **For the attention of** Alexandra Fournier and Florence Grégoire, the two people ECF names as ECS contacts in its June 2026 news on the ECS upgrade. Alexandra Fournier is EuroVelo and Projects Coordinator (ECS, training route inspectors, GIS data); Florence Grégoire is EuroVelo and Projects Officer (the ECS methodology and certification, GIS data, route quality). Their own addresses aren't published in plain text, so write to the team address and name them in the greeting.
- **Later, for a partnership:** Agathe Daudibon, EuroVelo & Cycling Tourism Director, who leads the EuroVelo team.
- **Subject line:** say what it is and what you ask, for example "An open-data audit of EuroVelo 8 and 15 against the ECS: feedback welcome".

## The standards

- [European Certification Standard](https://pro.eurovelo.com/projects/european-certification-standard) (EuroVelo for professionals): what ECS is, who uses it, how surveys and certification work, and the downloads. The full Handbook for Route Inspectors goes only to trained inspectors and licensed partners.
- [ECS short manual 2026, "Introduction to the methodology"](https://eurovelo.com/download/document/ECS-short-manual-2026-final.pdf): the current criteria, tier by tier. Section 2 is the one to read; section 4 covers certification.
- [ECS upgrade and new route inspectors](https://pro.eurovelo.com/news/2026-06-15_ecs-upgrade-and-new-eurovelo-route-inspectors) (June 2026): what changed in 2026. Daily sections are rated one to three stars for the essential, important and additional tiers; any 100 km stretch whose daily sections all meet the essential criteria can be certified; the criteria now follow the UNECE quality requirements for cycling infrastructure.
- [ECS leaflet](https://pro.eurovelo.com/download/document/ECS-flyer-2023-final_online.pdf) (2023): a short introduction.
- [EuroVelo 15 Rhine certification report](https://eurovelo.com/download/document/EuroVelo-15-Rhine-Cycle-Route-Certification-Report-2025.pdf) (2025): what a certification report looks like, with the share of the route at each tier and a table of daily sections.
- [New look for EuroVelo maps](https://en.eurovelo.com/news/2026-05-27_new-look-for-eurovelo-maps) (May 2026): the map's status categories, the ones in the GPX.
- [ECS quality criteria 2021](https://eurovelo.com/download/document/ECS-quality-criteria-2021.pdf): the previous criteria, superseded by the 2026 manual; useful to see what changed.
- [Route Inspectors' trainings](https://pro.eurovelo.com/news/route-certification-trainings): how inspectors are trained to survey a route by bike.
- [EuroVelo GPX tracks: licence and disclaimer](https://pro.eurovelo.com/download/document/EuroVelo%20GPX%20tracks_License%20and%20disclaimer_20251211.pdf) (December 2025): the ODbL terms the audit uses EuroVelo's data under.
- [EuroVelo Data Hub](https://pro.eurovelo.com/projects/eurovelo-data-hub): ECF's reports on the network, including the yearly route development status report.

## How the audit differs from the 2026 manual

| Criterion | ECS 2026: essential / important | The audit now (`eurovelo-ecs-v0`) |
|---|---|---|
| Continuity | No physical or legal disruptions, at most 10 dismounts and 500 m of pushing per daily section / stairs must be "easy" | Essential: no missing link and at most 20% of each km unmatched to the map. Steps are findings. |
| Traffic | Five categories from speed and traffic volume. No very high traffic and at most 50% high per daily section / no high traffic and at most 50% moderate | Traffic stress (LTS 1–4) estimated from road class, speed limits and lanes, with no traffic volumes. Essential: at most 100 m of LTS 4 per km. Important: 80% of each km LTS 1–2. |
| Crossings | None very dangerous | Not checked |
| Surface | Moderately rideable everywhere / 50% of each daily section well rideable | Important only: 80% of each km paved or compacted |
| Climbing | At most 1,000 m of climbing per daily section, each way / at most 500 m | Important only: no 100 m steeper than 8%. Climbing per daily section is measured but not a criterion. |
| Signing | Essential: a sign at least every 5 km, none missing at main junctions, EuroVelo branding | Important: EuroVelo publishes the daily section as signed or certified |
| Attractiveness | At least one significant attraction per daily section / at most 25% with loud noise, dust or smells | Not checked (scenery and highlights are measured for riders) |
| Public transport | Bikes carried every 150 km, two services a day / every 75 km, four services a day | Same spacing; how often services run is not checked |
| Services | Accommodation, food and water, cycle repair / non-camping accommodation, a rest area with table, benches and shelter, toilets every 15 km, a bike repair shop | The same, except rest areas, which are not checked |
| Communication | Official websites and information along the route | Not checked |

Two of the audit's working assumptions don't come from the 2026 manual. Its 1 km pieces come from the 2018 ECS manual, which recorded routes in 1 km "minor sections"; since 2021, ECS records segments of uniform character (200 m to 5 km) and judges daily sections. And its rule that a place counts when it is within 5 km, or 30 minutes in the mountains (D17), is not in the 2026 short manual, the 2021 criteria or the 2018 manual; it may be in the handbook for inspectors, which isn't public.

## Behind the text

- **Criteria and their wording:** `engine/profiles/eurovelo-ecs-v0.yaml`; the access limits are in `engine/profiles/services-v0.yaml`. Decisions D13 (placeholder thresholds), D17 (access limits), D20 (stations without timetables), D21 (the 2026 short manual's services wording) and D105 (certified counts as signed).
- **Figures left out:** with the audit's present tiers, EV15 meets the essential criteria on 93% of its 1,463 km and EV8 on 56% of 7,213 km (bundles of 2026-11-03). They are left out of the email because those tiers aren't yet the 2026 manual's (signing, for one, is essential there), and ECF would read them against its own certification of EV15, which requires the essential criteria on all of the certified route.
- **Before sending (D5):** nothing in the email should suggest ECF endorses Kilometrica; EuroVelo data is credited under the ODbL.
- **Licences:** ECS surveys and the ECS app need a three-year licence from ECF, and only trained EuroVelo Route Inspectors may survey. The email presents the audit as indicative, from open data, and not an ECS survey; licensing may still come up in reply.
- **If ECF asks for results:** the busy-road rule may count rural mountain roads as busy (section 13), which lowers traffic safety and low traffic. EV15's certified sections count as signed since D105; before, its important-criteria share was 14%, now 57%.
