import { Label, Switch } from '@dpg/ui';

export const WithLabel = () => (
  <div className="flex items-center gap-2">
    <Switch id="train" defaultSelected />
    <Label htmlFor="train">Train at both ends</Label>
  </div>
);

export const Sizes = () => (
  <div className="grid gap-3">
    <div className="flex items-center gap-2">
      <Switch id="pass" />
      <Label htmlFor="pass">Trip Pass</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="small" size="sm" defaultSelected />
      <Label htmlFor="small">Small</Label>
    </div>
  </div>
);
