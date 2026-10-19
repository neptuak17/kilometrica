# Building with the Kilometrica UI kit

Kilometrica plans long-distance cycle trips: Dream finds a stretch of a route that suits the rider; Plan turns it into days, nights and the few calls only the rider can make. This kit is shadcn/ui on React Aria with Kilometrica's theme. Everything is on `window.KilometricaUI`.

## Setup

- No provider or wrapper is needed: with `styles.css` loaded, components are styled. Text is Inter (`font-sans`).
- Dark mode: put `data-theme="dark"` on `<html>` (or any ancestor element); every colour and the components' dark styles switch. The `dark` class alone switches only the components' dark styles, not the colours, so don't use it on its own.
- Props follow React Aria: `onPress` (not `onClick`) on `Button`; `isDisabled`; `isSelected` / `defaultSelected` on `Checkbox`, `Switch`, `Toggle`; `defaultOpen` on `DialogTrigger`, `PopoverTrigger`, `TooltipTrigger`; `defaultSelectedKey` on `Select` and `Tabs`; `id` on `SelectItem`, `TabsTrigger`, `TabsContent`, `ToggleGroupItem`; `selectionMode` and `defaultSelectedKeys` on `ToggleGroup`.
- `Checkbox` and `Switch` are bare controls: give each an `id` and put a `<Label htmlFor>` beside it. A labelled input is `<TextField><Label>…</Label><Input /></TextField>`. `Table` needs an `aria-label` and one `TableHead isRowHeader`.
- Overlays: `DialogTrigger` wraps a `Button` and a `Dialog`; `PopoverTrigger` wraps a `Button` and a `Popover`; `TooltipTrigger` wraps a trigger and a `Tooltip`.
- Icons: `KilometricaUI.Icons.<Name>` (Lucide), e.g. `Bed`, `Bike`, `Calendar`, `Check`, `CircleHelp`, `Clock`, `CloudRain`, `Droplet`, `ExternalLink`, `Info`, `Lock`, `Map`, `MapPin`, `Mountain`, `Route`, `Ship`, `Sun`, `Tent`, `Train`, `TriangleAlert`, `Utensils`, `Wind`. Inside a `Button`, mark an icon `data-icon="inline-start"` or `"inline-end"`.

## Styling: Tailwind classes compiled into styles.css

Only compiled classes work; arbitrary values such as `bg-[#123456]` or `w-[37px]` do not.

| Family | Classes |
|---|---|
| Layout | `flex`, `grid`, `inline-flex`, `hidden`, `flex-col`, `flex-wrap`, `flex-1`, `items-center`, `justify-between`, `grid-cols-1`…`4` (also `sm:`, `md:`, `lg:`), `col-span-2` |
| Spacing | `gap-1`…`gap-12`, `p-`/`px-`/`py-`/`m-`/`mx-`/`mt-`/`mb-` 0…16, `mx-auto`, `space-y-2`…`6` |
| Size | `w-full`, `w-fit`, `max-w-xs`…`max-w-6xl`, `min-h-screen`, `size-4`…`size-10` |
| Type | `text-xs`…`text-4xl`, `font-medium`, `font-semibold`, `font-bold`, `font-heading`, `tracking-tight`, `tabular-nums`, `truncate` |
| Colour | `bg-`/`text-`/`border-` with `background`, `foreground`, `card`, `primary`, `primary-foreground`, `secondary`, `muted`, `muted-foreground`, `accent`, `destructive`, `border` |
| Kilometrica meaning | `headsup` (amber: something to watch), `highlight` (green: a reason it fits), `unknown` (grey: no data), `effort-within`, `effort-harder`, `effort-beyond`, `route`, `route-chosen`, e.g. `text-headsup`, `bg-unknown text-unknown-foreground`, `ring-route-chosen` |
| Surfaces | `border`, `rounded-xl`, `rounded-2xl`, `rounded-full`, `shadow-sm`, `ring-1` |

## Where the truth lives

`styles.css` (it imports `tokens.css`, the fonts and the compiled `components/bundle.css`); `tokens.json` for every colour's value and usage note, light and dark (`tokens.css` is generated from it: light in `:root`, dark in `[data-theme="dark"]`); per component, `components/<Name>/<Name>.d.ts` for props and `components/<Name>/README.md` for usage. Kilometrica's own pieces are `StretchCard`, `DayRow`, `ChangeBar`, `EffortChart` and `ElevationProfile` (group `km`).

## Kilometrica's design rules

- Plain language, numbers in the rider's terms: km, hours, "Day 5".
- Missing data is shown as unknown with "check yourself", never as zero: the `unknown` colour and `Icons.CircleHelp`.
- Warnings use `headsup` with `Icons.TriangleAlert`; reasons and sights use `highlight` with `Icons.Check`. At most 3 heads-ups and 3 highlights per day.
- No sign-in or account screens. Kilometrica hands riders off to other sites and apps (`LinkButton` to a hotel's website or Google Maps); it never books or navigates itself.

## Example

```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Button, Icons } = window.KilometricaUI;

<Card className="max-w-sm">
  <CardHeader>
    <CardTitle className="flex items-center gap-2"><Icons.Bike className="size-4" /> Day 5 · Altea → Benidorm</CardTitle>
    <CardDescription>74 km · 5 h 30 riding · a harder day</CardDescription>
  </CardHeader>
  <CardContent className="grid gap-2 text-sm">
    <p className="flex gap-2"><Icons.TriangleAlert className="size-4 text-headsup" /> 9 km on busy roads</p>
    <div className="flex items-center justify-between">
      <Badge variant="outline">Moderate</Badge>
      <Button size="sm" onPress={() => {}}>See the day</Button>
    </div>
  </CardContent>
</Card>
```
