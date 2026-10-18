import { ChangeBar } from '@dpg/ui';

const lines = [
  'One riding day more (6)',
  'Day 5 now ends at Benidorm, 74 km (was Alacant / Alicante, 96 km)',
  'Days 6 change too',
  'Settles: Day 5 is beyond Moderate: 96 km, 1,140 m',
];

export const Preview = () => (
  <ChangeBar
    mode="preview"
    label="Add a day"
    summary="One riding day more (6); day 5 now ends at Benidorm, 74 km (was Alacant / Alicante, 96 km); and 2 more changes"
    lines={lines}
  />
);

export const Changed = () => <ChangeBar mode="changed" summary="Night 5 moves to Sitges; day 6 is now 81 km (was 94)" />;

export const Undone = () => <ChangeBar mode="undone" summary="One riding day fewer (5); day 5 now ends at Alacant / Alicante, 96 km" />;
