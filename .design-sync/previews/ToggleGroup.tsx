import { Label, ToggleGroup, ToggleGroupItem } from '@dpg/ui';

export const Joined = () => (
  <div className="grid gap-1.5">
    <Label>How you sleep</Label>
    <ToggleGroup selectionMode="single" defaultSelectedKeys={['rooms']} variant="outline" spacing={0} aria-label="How you sleep">
      <ToggleGroupItem id="rooms">Rooms</ToggleGroupItem>
      <ToggleGroupItem id="camping">Camping</ToggleGroupItem>
      <ToggleGroupItem id="either">Either</ToggleGroupItem>
    </ToggleGroup>
  </div>
);

export const Spaced = () => (
  <div className="grid gap-1.5">
    <Label>Your bike</Label>
    <ToggleGroup selectionMode="single" defaultSelectedKeys={['touring']} variant="outline" aria-label="Your bike">
      <ToggleGroupItem id="touring">Touring</ToggleGroupItem>
      <ToggleGroupItem id="road">Road</ToggleGroupItem>
      <ToggleGroupItem id="gravel">Gravel</ToggleGroupItem>
      <ToggleGroupItem id="ebike">E-bike</ToggleGroupItem>
    </ToggleGroup>
  </div>
);
