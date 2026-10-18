import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from '@dpg/ui';
import { Info, TriangleAlert } from 'lucide-react';

export const Default = () => (
  <Alert className="max-w-md">
    <Info />
    <AlertTitle>Some places didn't load for days 15–21</AlertTitle>
    <AlertDescription>Water, food and places to stay may be missing there.</AlertDescription>
  </Alert>
);

export const Destructive = () => (
  <Alert variant="destructive" className="max-w-md">
    <TriangleAlert />
    <AlertTitle>Day 5 is beyond your level</AlertTitle>
    <AlertDescription>96 km and 1,140 m against your usual 65 km.</AlertDescription>
  </Alert>
);

export const WithAction = () => (
  <Alert className="max-w-md">
    <Info />
    <AlertTitle>Places didn't load</AlertTitle>
    <AlertDescription>Days 15–21 may be missing water and food.</AlertDescription>
    <AlertAction>
      <Button size="xs" variant="outline">
        Try again
      </Button>
    </AlertAction>
  </Alert>
);
