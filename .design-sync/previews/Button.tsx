import { Button } from '@dpg/ui';
import { ArrowRight, Map, Plus } from 'lucide-react';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>Plan this</Button>
    <Button variant="secondary">Pin to compare</Button>
    <Button variant="outline">Change</Button>
    <Button variant="ghost">Show 5 more</Button>
    <Button variant="destructive">Delete plan</Button>
    <Button variant="link">See day 3</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="xs">Extra small</Button>
    <Button size="sm">Small</Button>
    <Button>Default</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>
      Plan this <ArrowRight data-icon="inline-end" />
    </Button>
    <Button variant="outline">
      <Plus data-icon="inline-start" /> Add a day
    </Button>
    <Button size="icon" aria-label="Show the map">
      <Map />
    </Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button isDisabled>Apply</Button>
    <Button variant="outline" isDisabled>
      Undo
    </Button>
  </div>
);
