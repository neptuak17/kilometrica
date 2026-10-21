/**
 * The question as chips (11.7): each answer is a chip that opens its own small editor. Level and days start unset
 * and stand out until given, since no stretch is shown without them.
 */
import type { DreamFile } from "@dpg/contracts";
import type { Pref } from "@dpg/dream";
import { MONTHS_LONG } from "@dpg/planner";
import {
  Button,
  cn,
  Icons,
  Input,
  Label,
  Popover,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  TextField,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@dpg/ui";
import type { ReactNode } from "react";
import { Dialog, type Key } from "react-aria-components";
import { SELECTED } from "../rider/Questions";
import { and, type Ask, type Level, PACE, PREFS, STAY, SURFACES, surfacesText, WAY } from "./ask";

export type ChipId = "level" | "days" | "pace" | "month" | "surfaces" | "scenery" | "stay" | "direction";

const first = (keys: Set<Key>) => [...keys][0];

export function Chips({ a, levels, themes, open, onOpen, onChange }: {
  a: Ask;
  levels: Level[];
  themes: DreamFile["themes"];
  open: ChipId | null;
  onOpen: (c: ChipId | null) => void;
  onChange: (patch: Partial<Ask>) => void;
}) {
  const level = levels.find((l) => l.level === a.level);
  const titles = Object.fromEntries(themes.map((t) => [t.id, t.title]));

  const chip = (id: ChipId, icon: ReactNode, label: string, title: string, description: string, editor: ReactNode, unset = false) => (
    <PopoverTrigger key={id} isOpen={open === id} onOpenChange={(o) => onOpen(o ? id : null)}>
      <Button variant={unset ? "default" : "outline"} size="sm">
        {icon}
        {label}
        <Icons.ChevronDown data-icon="inline-end" />
      </Button>
      <Popover placement="bottom start" className="w-[min(26rem,calc(100vw-2rem))]">
        <Dialog aria-label={title} className="flex flex-col gap-4 outline-none">
          <PopoverHeader>
            <PopoverTitle slot="title" className="font-semibold">
              {title}
            </PopoverTitle>
            <PopoverDescription>{description}</PopoverDescription>
          </PopoverHeader>
          {editor}
          <div className="flex justify-end">
            <Button onPress={() => onOpen(null)}>Done</Button>
          </div>
        </Dialog>
      </Popover>
    </PopoverTrigger>
  );

  const single = <T extends string>(label: string, values: readonly T[], current: T, text: (v: T) => string, set: (v: T) => void) => (
    <ToggleGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[current]}
      onSelectionChange={(k) => set(first(k) as T)}
      variant="outline"
      spacing={0}
      className="flex-wrap"
    >
      {values.map((v) => (
        <ToggleGroupItem key={v} id={v} className={SELECTED}>
          {text(v)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  const levelEditor = (
    <div role="radiogroup" aria-label="Your level" className="grid gap-1.5">
      {levels.map((l) => {
        const on = a.level === l.level;
        return (
          <button
            key={l.level}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange({ level: l.level })}
            className={cn(
              "grid cursor-pointer grid-cols-[1rem_1fr] gap-x-3 rounded-2xl border px-3 py-2.5 text-left transition-colors hover:bg-muted",
              on ? "border-primary bg-primary/10" : "border-border",
            )}
          >
            <span className={cn("mt-1 size-4 rounded-full border", on ? "border-[5px] border-primary" : "border-muted-foreground")} />
            <span>
              <span className="block font-semibold">
                {l.level} · {l.name}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {l.km_min}–{l.km_max} km a day with luggage, up to about {l.climb_max_m.toLocaleString("en-GB")} m of climbing
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const daysEditor = (
    <div className="grid gap-3">
      <TextField
        className="grid gap-1.5"
        value={a.days === null ? "" : String(a.days)}
        onChange={(v) => onChange({ days: v === "" ? null : Math.max(1, Math.min(60, Math.round(Number(v)) || 1)) })}
      >
        <Label>Days in all</Label>
        <Input type="number" min={1} max={60} placeholder="7" />
      </TextField>
      <div className="flex flex-wrap gap-2">
        {[3, 5, 7, 10, 14].map((d) => (
          <Button key={d} variant={a.days === d ? "secondary" : "outline"} size="sm" onPress={() => onChange({ days: d })}>
            {d} days
          </Button>
        ))}
      </div>
    </div>
  );

  const monthEditor = (
    <ToggleGroup
      aria-label="Month"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[a.month === null ? "any" : String(a.month)]}
      onSelectionChange={(k) => {
        const v = first(k);
        onChange({ month: v === undefined || v === "any" ? null : Number(v) });
      }}
      variant="outline"
      className="grid w-full grid-cols-3 gap-1.5"
    >
      <ToggleGroupItem id="any" className={cn("col-span-3", SELECTED)}>
        Any month: the best for each stretch
      </ToggleGroupItem>
      {MONTHS_LONG.map((m, i) => (
        <ToggleGroupItem key={m} id={String(i)} className={SELECTED}>
          {m}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  const surfacesEditor = (
    <div className="grid gap-2.5">
      {SURFACES.map((s) => (
        <div key={s.key} className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{s.label[0]!.toUpperCase() + s.label.slice(1)}</span>
          {single(s.label, PREFS, a.surfaces[s.key], (p: Pref) => (p === "ok" ? "Fine" : p === "prefer" ? "Prefer" : "Avoid"), (p) =>
            onChange({ surfaces: { ...a.surfaces, [s.key]: p } }),
          )}
        </div>
      ))}
    </div>
  );

  const sceneryEditor = (
    <ToggleGroup
      aria-label="Scenery"
      selectionMode="multiple"
      selectedKeys={a.themes}
      onSelectionChange={(k) => onChange({ themes: [...k].map(String) })}
      variant="outline"
      className="flex-wrap"
    >
      {themes.map((t) => (
        <ToggleGroupItem key={t.id} id={t.id} className={SELECTED}>
          {t.title}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div role="group" aria-label="Your trip" className="flex flex-wrap items-center gap-2">
      {chip("level", <Icons.Bike />, level?.name ?? "Your level", "Your level", "An ordinary good day for you. We measure every stretch against it.", levelEditor, !level)}
      {chip(
        "days",
        <Icons.Calendar />,
        a.days === null ? "How many days?" : `${a.days} ${a.days === 1 ? "day" : "days"}`,
        "How many days",
        "All the days you have, rest days included: how you like to travel decides how many are rest days.",
        daysEditor,
        a.days === null,
      )}
      {chip(
        "pace",
        <Icons.Clock />,
        PACE[a.pace],
        "How do you like to travel?",
        "Relaxed: a rest day about every 4 riding days. Steady: about every 6. Keep moving: none. You can move them in Plan.",
        single("How do you like to travel", ["relaxed", "steady", "moving"] as const, a.pace, (v) => PACE[v], (v) => onChange({ pace: v })),
      )}
      {chip("month", <Icons.Sun />, a.month === null ? "Any month" : MONTHS_LONG[a.month]!, "When", "Choose a month, or let each stretch show its best one.", monthEditor)}
      {chip("surfaces", <Icons.Route />, surfacesText(a), "Surfaces", "What you'd rather ride on.", surfacesEditor)}
      {chip(
        "scenery",
        <Icons.Mountain />,
        a.themes.length ? and(a.themes.map((t) => titles[t] ?? t)) : "Any scenery",
        "Scenery",
        "Choose any you'd like more of.",
        sceneryEditor,
      )}
      {chip("stay", <Icons.Bed />, STAY[a.stay], "Where you sleep", "Places to stay along the way.", single("Where you sleep", ["any", "rooms", "camping"] as const, a.stay, (v) => STAY[v], (v) => onChange({ stay: v })))}
      {chip(
        "direction",
        <Icons.ArrowRight />,
        WAY[a.direction],
        "Which way",
        "Ride the route in its own direction, against it, or either.",
        single("Which way", ["either", "forward", "reverse"] as const, a.direction, (v) => WAY[v], (v) => onChange({ direction: v })),
      )}
      <Toggle variant="outline" size="sm" className={SELECTED} isSelected={a.trainBothEnds} onChange={(on) => onChange({ trainBothEnds: on })}>
        <Icons.Train />
        Train at both ends
      </Toggle>
      <Toggle variant="outline" size="sm" className={SELECTED} isSelected={a.avoidBusy} onChange={(on) => onChange({ avoidBusy: on })}>
        {a.avoidBusy && <Icons.Check />}
        Avoid busy roads
      </Toggle>
    </div>
  );
}
