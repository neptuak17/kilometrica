import { Badge } from '@dpg/ui';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>Trip Pass</Badge>
    <Badge variant="secondary">7 days</Badge>
    <Badge variant="outline">Moderate</Badge>
    <Badge variant="destructive">Beyond your selected level</Badge>
  </div>
);

export const Meaning = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge className="bg-headsup text-black">Heads-up</Badge>
    <Badge className="bg-highlight text-white">Highlight</Badge>
    <Badge className="bg-unknown text-unknown-foreground">No data</Badge>
  </div>
);

export const Rank = () => (
  <div className="flex items-center gap-2 text-sm font-semibold">
    <Badge className="size-6 rounded-full p-0">1</Badge> Valencia → El Vendrell
  </div>
);
