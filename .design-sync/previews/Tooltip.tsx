import { Button, Tooltip, TooltipTrigger } from '@dpg/ui';

export const Open = () => (
  <TooltipTrigger defaultOpen>
    <Button variant="outline">Day 5</Button>
    <Tooltip>Your usual day: about 4 h 25 riding</Tooltip>
  </TooltipTrigger>
);
