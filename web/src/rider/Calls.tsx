/**
 * The walk-through of the plan's calls (11.6, 11.7) in the new look (D53, D54): the decisions only the rider can
 * make, one at a time, each with its options worked out. An option is shown on the plan first; Apply settles the call
 * and the next one follows. "Keep it" settles it as it is. In the teaser the calls are counted, not shown (D45).
 */
import type { PlanItem } from "@dpg/planner";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Icons } from "@dpg/ui";
import { useState } from "react";
import { Locked } from "./Locked";

interface Props {
  calls: PlanItem[];
  free: boolean;
  readOnly: boolean;
  /** The call and option being previewed, as "callId/optionId". */
  previewing: string | null;
  onOption: (item: PlanItem, optionId: string) => void;
  onShowDay: (day: number) => void;
}

export function Calls({ calls, free, readOnly, previewing, onOption, onShowDay }: Props) {
  const [index, setIndex] = useState(0);
  if (!calls.length) return null;
  if (free) {
    return (
      <Locked title={calls.length === 1 ? "1 thing needs your call" : `${calls.length} things need your call`}>
        What they are, and their options worked out, with a Trip Pass.
      </Locked>
    );
  }
  const i = Math.min(index, calls.length - 1);
  const call = calls[i]!;
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Your call{calls.length > 1 ? ` · ${i + 1} of ${calls.length}` : ""}
        </CardDescription>
        <CardTitle className="text-lg leading-snug font-semibold">{call.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p>{call.why}</p>
        {call.day !== null && (
          <div>
            <Button variant="link" size="sm" className="px-0" onPress={() => onShowDay(call.day!)}>
              See day {call.day}
              <Icons.ChevronRight data-icon="inline-end" />
            </Button>
          </div>
        )}
        {!readOnly && (
          <>
            <div role="radiogroup" aria-label="Options" className="grid gap-2">
              {(call.options ?? []).map((o) => {
                const on = previewing === `${call.id}/${o.id}`;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onOption(call, o.id)}
                    className={cn(
                      "grid cursor-pointer gap-0.5 rounded-2xl border px-3.5 py-3 text-left transition-colors hover:bg-muted",
                      on ? "border-2 border-primary bg-primary/8" : "border-border",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {o.label}
                      {on && <span className="rounded-full bg-primary px-2 py-px text-[11px] font-semibold text-primary-foreground">Previewing</span>}
                    </span>
                    <span className="text-muted-foreground">{o.effect}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Choosing an option shows the changed plan everywhere. Apply keeps it; Discard puts it back.</p>
          </>
        )}
        {calls.length > 1 && (
          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" isDisabled={i === 0} onPress={() => setIndex(i - 1)}>
              <Icons.ChevronLeft data-icon="inline-start" />
              Previous
            </Button>
            <Button variant="outline" size="sm" isDisabled={i === calls.length - 1} onPress={() => setIndex(i + 1)}>
              Next
              <Icons.ChevronRight data-icon="inline-end" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
