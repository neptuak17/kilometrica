import { Card, CardContent, EffortChart } from '@dpg/ui';

export const Trip = () => (
  <Card className="max-w-2xl">
    <CardContent>
      <EffortChart
        usual={4.5}
        usualLabel="Your usual day at Moderate, about 4 h 30"
        selected={4}
        days={[
          { day: 1, hours: 3.17, label: '3 h 10', effort: 'within' },
          { day: 2, hours: 2.33, label: '2 h 20', effort: 'within' },
          { day: 3, hours: 3.42, label: '3 h 25', effort: 'within' },
          { day: 4, hours: 5.33, label: '5 h 20', effort: 'harder' },
          { day: 5, hours: 4.0, label: '4 h 00', effort: 'within' },
          { day: 6, hours: 4.83, label: '4 h 50', effort: 'within' },
        ]}
      />
    </CardContent>
  </Card>
);

export const LongTrip = () => (
  <Card className="max-w-2xl">
    <CardContent>
      <EffortChart
        usual={5}
        usualLabel="Your usual day at Challenging, about 5 h 00"
        days={Array.from({ length: 18 }, (_, i) => {
          const hours = 3.5 + 2.5 * Math.abs(Math.sin(i * 1.3));
          return { day: i + 1, hours, label: `${Math.floor(hours)} h`, effort: hours > 6.5 ? ('beyond' as const) : hours > 5.5 ? ('harder' as const) : ('within' as const) };
        })}
      />
    </CardContent>
  </Card>
);
