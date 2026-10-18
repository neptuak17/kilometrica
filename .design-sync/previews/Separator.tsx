import { Separator } from '@dpg/ui';

export const Horizontal = () => (
  <div className="grid max-w-sm gap-3 text-sm">
    <p>Cádiz → Fuengirola · 4 days · 292 km</p>
    <Separator />
    <p className="text-muted-foreground">Ends Tue 18 May 2027.</p>
  </div>
);

export const Vertical = () => (
  <div className="flex items-center gap-3 text-sm">
    <span>62 km</span>
    <Separator orientation="vertical" className="h-4" />
    <span>4 h 05</span>
    <Separator orientation="vertical" className="h-4" />
    <span>within your level</span>
  </div>
);
