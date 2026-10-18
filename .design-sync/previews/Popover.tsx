import { Button, Popover, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@dpg/ui';

export const Open = () => (
  <PopoverTrigger defaultOpen>
    <Button variant="outline">How well we know these days</Button>
    <Popover>
      <PopoverHeader>
        <PopoverTitle>How well we know these days</PopoverTitle>
        <PopoverDescription>
          Surfaces known for 97% of the way; opening dates for 12% of the beds at your stops.
        </PopoverDescription>
      </PopoverHeader>
    </Popover>
  </PopoverTrigger>
);
