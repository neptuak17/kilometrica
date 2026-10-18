import { StretchCard } from '@dpg/ui';

export const Result = () => (
  <div className="max-w-md">
    <StretchCard
      rank={1}
      name="Valencia → El Vendrell"
      facts="7 days · 344 km · 49 km a day · ↑ 285 m a day · Easy-moderate"
      when="Best in May: best-time 87 of 100"
      why={['Coast & beaches: strong here', 'Villages & heritage: strong here']}
      watch={['steepest 500 m at 11%', '4 audit warnings: details with a Trip Pass']}
      checks={['14 of 120 places to stay publish no opening season: check dates ahead.', 'Climbing is unknown for 2.1 km of this stretch.']}
      planHref="#plan"
      onCompare={() => {}}
    />
  </div>
);

export const Chosen = () => (
  <div className="max-w-md">
    <StretchCard
      rank={2}
      name="Alcossebre → Blanes"
      facts="7 days · 356 km · 51 km a day · ↑ 374 m a day · Easy-moderate"
      when="Best in May: best-time 85 of 100"
      why={['Coast & beaches: strong here']}
      watch={['14 km on busy roads', 'steepest 500 m at 19%']}
      checks={['No climate data for part of this stretch.']}
      chosen
      comparing
      planHref="#plan"
      onCompare={() => {}}
    />
  </div>
);

export const OwnPick = () => (
  <div className="max-w-md">
    <StretchCard
      name="Barcelona → Narbonne"
      facts="7 days · 384 km · 55 km a day · ↑ at least 307 m a day · at least Easy-moderate"
      when="Best in October: best-time 83 of 100"
      why={['Villages & heritage: strong here']}
      watch={['16 km on busy roads', 'steepest 500 m at 11%']}
      checks={[]}
      planHref="#plan"
    />
  </div>
);
