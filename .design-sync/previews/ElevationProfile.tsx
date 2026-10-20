import { Card, ElevationProfile } from '@dpg/ui';

// Made-up terrain: a rolling coast, one climb, and a stretch where the terrain is unknown (the line breaks).
const points = Array.from({ length: 301 }, (_, km) => {
  const m = 20 + 30 * Math.sin(km / 9) ** 2 + (km > 150 && km < 190 ? 380 * Math.sin(((km - 150) / 40) * Math.PI) : 0);
  return { km, m: km > 210 && km < 222 ? null : Math.round(m) };
});
const ends = [0, 62, 133, 191, 249, 300];

export const Trip = () => (
  <Card className="max-w-3xl py-3">
    <ElevationProfile
      label="Elevation along the trip"
      className="px-4"
      points={points}
      spans={ends.slice(1).map((to, i) => ({ from: ends[i]!, to, label: `Day ${i + 1}` }))}
      markers={ends.slice(1, -1).map((km, i) => ({ km, label: String(i + 1), title: `Night ${i + 1}`, kept: i === 1 }))}
    />
  </Card>
);

export const DayWithMarks = () => (
  <Card className="max-w-3xl py-3">
    <ElevationProfile label="Elevation for day 3, with a mark every 10 km" className="px-4" tone="chosen" marks={10} points={points.slice(133, 192).map((p) => ({ ...p, km: p.km - 133 }))} />
  </Card>
);

export const Day = () => (
  <Card className="max-w-3xl py-3">
    <ElevationProfile label="Elevation for day 3" className="px-4" tone="chosen" points={points.slice(133, 192).map((p) => ({ ...p, km: p.km - 133 }))} />
  </Card>
);
