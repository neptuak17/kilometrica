/**
 * Step 1 (11.6) in the new look (D53, D54): a few questions, each with a default, asked only because they change the
 * plan. Dream suggested the stretch, time frame, days and level; the dates are confirmed here (D48). Pace comes from
 * the level and the bike, never from fitness data (D35).
 */
import type { DailySection, RiderLevel } from "@dpg/contracts";
import { clock, MONTHS_LONG, type PlanInputs } from "@dpg/planner";
import {
  Checkbox,
  cn,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextField,
  ToggleGroup,
  ToggleGroupItem,
} from "@dpg/ui";
import { useId, type ReactNode } from "react";

interface Props {
  inputs: PlanInputs;
  levels: RiderLevel[];
  daily: DailySection[];
  /** The month Dream suggested, until the rider confirms a date. */
  suggestedMonth: number | null;
  datesConfirmed: boolean;
  readOnly: boolean;
  onChange: (next: PlanInputs, confirmDates?: boolean) => void;
}

const SLEEP = [
  ["rooms", "Rooms"],
  ["camping", "Camping"],
  ["mix", "Either"],
] as const;
const BIKES = [
  ["touring", "Touring"],
  ["road", "Road"],
  ["gravel", "Gravel"],
  ["ebike", "E-bike"],
] as const;
const STOPS = [
  ["short", "Short"],
  ["normal", "Normal"],
  ["long", "Long"],
] as const;
/** The kit's toggles mark the chosen one faintly; an answer should be plain to see. */
export const SELECTED = "data-selected:border-primary data-selected:bg-primary/10 data-selected:font-semibold data-selected:text-foreground";

const WAYS = [
  ["forward", "As the route runs"],
  ["reverse", "The other way"],
] as const;

function Field({ label, hint, children, attention }: { label: string; hint?: ReactNode; children: ReactNode; attention?: boolean }) {
  return (
    <div className="grid content-start gap-1.5">
      <span className={cn("text-sm font-medium", attention && "text-primary")}>{label}</span>
      {children}
      {hint && <span className={cn("text-xs", attention ? "text-primary" : "text-muted-foreground")}>{hint}</span>}
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onPick, disabled }: { label: string; value: T; options: readonly (readonly [T, string])[]; onPick: (v: T) => void; disabled: boolean }) {
  return (
    <ToggleGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(k) => {
        const v = [...k][0];
        if (v !== undefined) onPick(v as T);
      }}
      isDisabled={disabled}
      variant="outline"
      spacing={0}
      className="flex-wrap"
    >
      {options.map(([v, text]) => (
        <ToggleGroupItem key={v} id={v} className={SELECTED}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} isSelected={checked} isDisabled={disabled} onChange={onChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

export function Questions({ inputs, levels, daily, suggestedMonth, datesConfirmed, readOnly, onChange }: Props) {
  const set = <K extends keyof PlanInputs>(k: K, v: PlanInputs[K]) => onChange({ ...inputs, [k]: v });
  const sections = [...daily].sort((a, b) => a.from_m - b.from_m);
  const first = sections.find((s) => Math.abs(s.from_m - inputs.fromM) < 1) ?? sections[0];
  const last = sections.find((s) => Math.abs(s.to_m - inputs.toM) < 1) ?? sections[sections.length - 1];
  const setRange = (a: number, b: number) => {
    const sa = sections.find((s) => s.number === a);
    const sb = sections.find((s) => s.number === b);
    if (!sa || !sb) return;
    onChange({ ...inputs, fromM: Math.min(sa.from_m, sb.from_m), toM: Math.max(sa.to_m, sb.to_m) });
  };
  const level = levels.find((l) => l.level === inputs.level);
  const section = (label: string, value: number | undefined, pick: (n: number) => void) => (
    <Field label={label}>
      <Select aria-label={label} selectedKey={value === undefined ? null : String(value)} onSelectionChange={(k) => k !== null && pick(Number(k))} isDisabled={readOnly} className="w-full">
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sections.map((s) => (
            <SelectItem key={s.number} id={String(s.number)} textValue={`${s.number}: ${s.title}`}>
              {s.number}: {s.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Start date"
          attention={!datesConfirmed && suggestedMonth !== null}
          hint={!datesConfirmed && suggestedMonth !== null ? `Dream suggested ${MONTHS_LONG[suggestedMonth]}: confirm your start date.` : undefined}
        >
          <TextField aria-label="Start date" value={inputs.startDate} isDisabled={readOnly} onChange={(v) => v && onChange({ ...inputs, startDate: v }, true)}>
            <Input type="date" />
          </TextField>
        </Field>
        <Field label="Riding days" hint="Rest days can be added to any day later.">
          <TextField aria-label="Riding days" value={String(inputs.days)} isDisabled={readOnly} onChange={(v) => set("days", Math.max(1, Math.min(60, Math.round(Number(v)) || 1)))}>
            <Input type="number" min={1} max={60} />
          </TextField>
        </Field>
      </div>

      <Field label="Your level" hint={level ? `${level.km_min}–${level.km_max} km a day with luggage, up to about ${level.climb_max_m.toLocaleString("en-GB")} m of climbing.` : undefined}>
        <Select aria-label="Your level" selectedKey={String(inputs.level)} onSelectionChange={(k) => k !== null && set("level", Number(k))} isDisabled={readOnly} className="w-full">
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {levels.map((l) => (
              <SelectItem key={l.level} id={String(l.level)} textValue={`${l.level} · ${l.name}`}>
                {l.level} · {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your bike" hint="Sets your pace. An e-bike plans with help up to 25 km/h.">
          <Choice label="Your bike" value={inputs.bike} options={BIKES} disabled={readOnly} onPick={(v) => set("bike", v)} />
        </Field>
        <Field label="How you sleep">
          <Choice label="How you sleep" value={inputs.sleep} options={SLEEP} disabled={readOnly} onPick={(v) => set("sleep", v)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Off at">
          <TextField
            aria-label="Off at"
            value={clock(inputs.startMinutes)}
            isDisabled={readOnly}
            onChange={(v) => {
              const [h, m] = v.split(":").map(Number);
              if (h !== undefined && m !== undefined && !Number.isNaN(h) && !Number.isNaN(m)) set("startMinutes", h * 60 + m);
            }}
          >
            <Input type="time" step={900} />
          </TextField>
        </Field>
        <Field label="Stops during the day" hint={'For the "in by" times, and whether a day ends before dark.'}>
          <Choice label="Stops during the day" value={inputs.stopStyle} options={STOPS} disabled={readOnly} onPick={(v) => set("stopStyle", v)} />
        </Field>
      </div>

      <details className="group rounded-2xl border px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
          Stretch and preferences
          <Icons.ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {section("From section", first?.number, (n) => setRange(n, last?.number ?? n))}
            {section("To section", last?.number, (n) => setRange(first?.number ?? n, n))}
          </div>
          <Field label="Direction">
            <Choice label="Direction" value={inputs.direction} options={WAYS} disabled={readOnly} onPick={(v) => set("direction", v)} />
          </Field>
          <div className="grid gap-2.5">
            <Check label="Rather avoid busy roads" checked={inputs.avoidBusy} disabled={readOnly} onChange={(on) => set("avoidBusy", on)} />
            <Check label="Rather avoid gravel" checked={inputs.avoidGravel} disabled={readOnly} onChange={(on) => set("avoidGravel", on)} />
          </div>
        </div>
      </details>
    </div>
  );
}
