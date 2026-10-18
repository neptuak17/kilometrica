import { Label, TextField, Textarea } from '@dpg/ui';

export const Default = () => <Textarea aria-label="Notes" placeholder="Anything to remember for this trip" className="max-w-sm" />;

export const Labelled = () => (
  <TextField className="grid max-w-sm gap-1.5" defaultValue="Book Dénia early: it's a holiday weekend.">
    <Label>Notes</Label>
    <Textarea />
  </TextField>
);
