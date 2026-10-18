import { Checkbox, Input, Label, TextField } from '@dpg/ui';

export const ForField = () => (
  <TextField className="grid max-w-xs gap-1.5">
    <Label>Start date</Label>
    <Input type="date" />
  </TextField>
);

export const ForCheckbox = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="rest" />
    <Label htmlFor="rest">Rest day after this day</Label>
  </div>
);
