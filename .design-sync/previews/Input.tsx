import { Input, Label, TextField } from '@dpg/ui';

export const Default = () => <Input aria-label="Plan name" placeholder="Name this plan" className="max-w-xs" />;

export const DateField = () => (
  <TextField className="grid max-w-xs gap-1.5" defaultValue="2027-05-15">
    <Label>Start date</Label>
    <Input type="date" />
  </TextField>
);

export const NumberField = () => (
  <TextField className="grid max-w-xs gap-1.5" defaultValue="7">
    <Label>Riding days</Label>
    <Input type="number" />
  </TextField>
);
