import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dpg/ui';

export const Level = () => (
  <div className="grid max-w-xs gap-1.5">
    <Label>Level</Label>
    <Select aria-label="Level" defaultSelectedKey="3" className="w-full">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem id="1">Leisurely</SelectItem>
        <SelectItem id="2">Easy-moderate</SelectItem>
        <SelectItem id="3">Moderate</SelectItem>
        <SelectItem id="4">Challenging</SelectItem>
        <SelectItem id="5">Tough</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Placeholder = () => (
  <div className="grid max-w-xs gap-1.5">
    <Label>Start town</Label>
    <Select aria-label="Start town" placeholder="Choose a town…" className="w-full">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem id="valencia">Valencia (km 1,048)</SelectItem>
        <SelectItem id="tarragona">Tarragona (km 1,334)</SelectItem>
        <SelectItem id="barcelona">Barcelona (km 1,430)</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Small = () => (
  <Select aria-label="Stops" defaultSelectedKey="normal" className="w-fit">
    <SelectTrigger size="sm">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem id="short">Short stops</SelectItem>
      <SelectItem id="normal">Normal stops</SelectItem>
      <SelectItem id="long">Long stops</SelectItem>
    </SelectContent>
  </Select>
);
