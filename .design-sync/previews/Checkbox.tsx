import { Checkbox, Label } from '@dpg/ui';

export const WithLabel = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="busy" />
    <Label htmlFor="busy">Avoid busy roads</Label>
  </div>
);

export const States = () => (
  <div className="grid gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="booked" defaultSelected />
      <Label htmlFor="booked">Booked (keeps this night when the plan changes)</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="done" isDisabled />
      <Label htmlFor="done">Done</Label>
    </div>
  </div>
);
