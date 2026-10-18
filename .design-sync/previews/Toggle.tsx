import { Toggle } from '@dpg/ui';
import { Bike, Map } from 'lucide-react';

export const Default = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Toggle defaultSelected>
      <Map /> Map
    </Toggle>
    <Toggle>
      <Bike /> Bike shops
    </Toggle>
  </div>
);

export const Outline = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Toggle variant="outline" defaultSelected>
      Avoid gravel
    </Toggle>
    <Toggle variant="outline">Avoid busy roads</Toggle>
  </div>
);
