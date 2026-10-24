import { Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@dpg/ui';

export const Default = () => (
  <Card className="max-w-sm">
    <CardHeader>
      <CardTitle>Ready to go</CardTitle>
      <CardDescription>Accommodation every night, every day within your level, 4 checks before you leave.</CardDescription>
    </CardHeader>
    <CardContent>
      <p>
        <b>Can I do it?</b> Yes, at Moderate, with 1 harder day. Day 5 is the hardest: 96 km, about 7 h 25 riding.
      </p>
    </CardContent>
    <CardFooter className="justify-end gap-2">
      <Button variant="outline">Change</Button>
      <Button>Show the plan</Button>
    </CardFooter>
  </Card>
);

export const WithAction = () => (
  <Card className="max-w-sm">
    <CardHeader>
      <CardTitle>Where will I sleep?</CardTitle>
      <CardDescription>A stop every night; 3 of 6 rely on places with no May dates.</CardDescription>
      <CardAction>
        <Button variant="link" size="sm">
          +3 more
        </Button>
      </CardAction>
    </CardHeader>
  </Card>
);

export const Small = () => (
  <Card size="sm" className="max-w-xs">
    <CardContent>Day 3 · rest day at Dénia</CardContent>
  </Card>
);
