import { Label, TownSelect } from '@dpg/ui';

const towns = [
  { id: 'valencia', name: 'Valencia', km: 1048, station: 'València Nord' },
  { id: 'cambrils', name: 'Cambrils', km: 1303, station: 'Cambrils' },
  { id: 'tarragona', name: 'Tarragona', km: 1334, station: 'Tarragona' },
  { id: 'altafulla', name: 'Altafulla', km: 1346 },
  { id: 'barcelona', name: 'Barcelona', km: 1430, station: 'Barcelona-Passeig de Gràcia' },
  { id: 'korinthos', name: 'Κόρινθος', alt: 'Corinth', km: 6214, station: 'Korinthos' },
];

export const StartIn = () => (
  <div className="grid max-w-xs gap-1.5">
    <Label>Start in</Label>
    <TownSelect label="Start in" towns={towns} selected="tarragona" onSelect={() => {}} />
  </div>
);

export const AnyTown = () => (
  <div className="grid max-w-xs gap-1.5">
    <Label>End in</Label>
    <TownSelect label="End in" towns={towns} selected={null} anyLabel="Any town" onSelect={() => {}} />
  </div>
);

export const EnglishName = () => (
  <div className="grid max-w-xs gap-1.5">
    <Label>End in</Label>
    <TownSelect label="End in" towns={towns} selected="korinthos" onSelect={() => {}} />
  </div>
);
