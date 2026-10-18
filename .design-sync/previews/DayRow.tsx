import { Card, CardContent, DayRow } from '@dpg/ui';

export const DayList = () => (
  <Card size="sm" className="max-w-xl">
    <CardContent className="grid gap-0.5 px-2">
      <DayRow number={1} date="15/05" to="Cullera" km="62" hours="4 h 05" effort="within" items={3} />
      <DayRow number={2} date="16/05" to="Dénia" km="71" hours="4 h 40" effort="within" items={2} />
      <DayRow number={3} date="17/05" to="Dénia" rest />
      <DayRow number={4} date="18/05" to="Altea" km="58" hours="5 h 10" effort="harder" items={4} selected />
      <DayRow number={5} date="19/05" to="Alacant / Alicante" km="96" hours="7 h 25" effort="beyond" items={5} />
    </CardContent>
  </Card>
);

export const Changed = () => (
  <Card size="sm" className="max-w-xl">
    <CardContent className="grid gap-0.5 px-2">
      <DayRow number={5} date="19/05" to="Benidorm" km="74" hours="5 h 30" effort="harder" items={3} changed />
      <DayRow number={6} date="20/05" to="Alacant / Alicante" km="44" hours="3 h 05" effort="within" items={1} changed />
    </CardContent>
  </Card>
);
