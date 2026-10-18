import { Input, Label, TextField, Textarea } from '@dpg/ui';

export const Text = () => (
  <TextField className="grid max-w-xs gap-1.5" defaultValue="EV8 in May">
    <Label>Plan name</Label>
    <Input />
  </TextField>
);

export const Notes = () => (
  <TextField className="grid max-w-sm gap-1.5">
    <Label>Notes</Label>
    <Textarea placeholder="Ferry from Dénia? Ask about bike boxes." />
  </TextField>
);
