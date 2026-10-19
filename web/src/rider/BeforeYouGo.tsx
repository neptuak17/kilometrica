/**
 * Step 5 (11.6) in the new look (D53, D54): the to-do list with its handoffs (D41), the exports (D48) and sharing
 * without accounts (9.4). A plan moves to the phone for Go by its link, shown as a QR code (D49).
 */
import type { PlanItem, PlanResult } from "@dpg/planner";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, cn, Icons, Label } from "@dpg/ui";
import qrcode from "qrcode-generator";
import { useId, useMemo, useState } from "react";
import { Links } from "./DayCard";
import { Locked } from "./Locked";

export type ExportKind = "trip-gpx" | "ics" | "plan-file" | "trip-book";

interface Props {
  plan: PlanResult;
  free: boolean;
  readOnly: boolean;
  isPrivate: boolean;
  done: string[];
  onDone: (id: string) => void;
  onExport: (kind: ExportKind) => void;
  links: { full: string; itinerary: string };
}

const GROUPS: { title: string; test: (i: PlanItem) => boolean }[] = [
  { title: "Book and check places to stay", test: (i) => i.id.startsWith("bed:") || i.id.startsWith("book:") },
  { title: "Ferries and transport", test: (i) => i.id.startsWith("ferry:") || i.id.startsWith("transport:") },
  { title: "Getting there and back", test: (i) => i.id.startsWith("travel:") },
  { title: "Borders", test: (i) => i.id.startsWith("border:") },
  { title: "Check yourself: data we don't have", test: (i) => i.id.startsWith("data:") },
];

const EXPORTS: { kind: ExportKind; title: string; what: string; action: string }[] = [
  { kind: "trip-gpx", title: "Starter GPX for the whole trip", what: "Gaps marked at both ends, for your own route tool to finish. Each day has its own GPX on its card.", action: "GPX" },
  { kind: "ics", title: "Calendar file", what: "One all-day event per day, with the night's stop.", action: "Calendar" },
  { kind: "trip-book", title: "Trip book", what: "The brief and a page per day, to print or save as a PDF for when there's no signal.", action: "Trip book" },
  { kind: "plan-file", title: "Plan file", what: "To keep a copy, or open the plan on another computer.", action: "Plan file" },
];

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, "L");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
    } catch {
      return null;
    }
  }, [text]);
  if (!svg) return <p className="text-muted-foreground">This plan is too long for a QR code: send yourself the link instead.</p>;
  return <div className="size-40 shrink-0 rounded-xl bg-white p-1.5 ring-1 ring-border" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Copy({ text, label, variant = "outline" }: { text: string; label: string; variant?: "default" | "outline" }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant={variant}
      size="sm"
      onPress={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? <Icons.Check data-icon="inline-start" /> : <Icons.Share2 data-icon="inline-start" />}
      {ok ? "Copied" : label}
    </Button>
  );
}

export function BeforeYouGo({ plan, free, readOnly, isPrivate, done, onDone, onExport, links }: Props) {
  const base = useId();
  const todos = plan.items.filter((i) => i.kind === "todo");
  const [qr, setQr] = useState(false);
  if (free) {
    return (
      <Locked title="Before you go">
        {todos.length} {todos.length === 1 ? "thing" : "things"} to sort out. The list with its links, the trip book, GPX and calendar files, sharing
        and sending the plan to your phone, with a Trip Pass.
      </Locked>
    );
  }
  return (
    <section aria-labelledby={`${base}-title`} className="grid gap-5">
      <h2 id={`${base}-title`} className="text-2xl font-bold tracking-tight">
        Before you go
      </h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">To do</CardTitle>
          <CardDescription>Ticks stay in this browser. Booked nights are kept when the plan changes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {todos.length === 0 && <p className="text-muted-foreground">Nothing to sort out.</p>}
          {GROUPS.map((g) => {
            const mine = todos.filter(g.test);
            if (!mine.length) return null;
            return (
              <div key={g.title} className="grid gap-1">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h3>
                <ul>
                  {mine.map((i) => {
                    const id = `${base}-${i.id}`;
                    const on = done.includes(i.id);
                    return (
                      <li key={i.id} className="flex items-start gap-2.5 border-b py-2.5 last:border-b-0">
                        <Checkbox id={id} isSelected={on} isDisabled={readOnly} onChange={() => onDone(i.id)} className="mt-0.5" />
                        <div className="grid min-w-0 gap-1.5">
                          <Label htmlFor={id} className={cn("leading-snug font-normal", on && "text-muted-foreground line-through")}>
                            {i.title}
                          </Label>
                          <span className="text-muted-foreground">{i.why}</span>
                          <Links links={i.handoffs} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Take it with you</CardTitle>
        </CardHeader>
        <CardContent className="grid">
          {EXPORTS.map((x) => (
            <div key={x.kind} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
              <div className="grid min-w-0 flex-[1_1_240px]">
                <span className="font-semibold">{x.title}</span>
                <span className="text-xs text-muted-foreground">{x.what}</span>
              </div>
              <Button variant="outline" size="sm" onPress={() => onExport(x.kind)}>
                <Icons.Download data-icon="inline-start" />
                {x.action}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Share, and send to your phone</CardTitle>
          {!isPrivate && <CardDescription>Read-only links. The link holds the plan itself; nothing is stored on our side.</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-3">
          {isPrivate ? (
            <p className="text-muted-foreground">
              This plan is on your own route, which stays private: share it as a plan file. Whoever opens it also needs your route file.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>The full plan: riding partners can keep their own copy.</span>
                <Copy text={links.full} label="Copy the link" variant="default" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Where I'll be: dates and nightly stops only.</span>
                <Copy text={links.itinerary} label="Copy the link" />
              </div>
              <div className="grid gap-3 rounded-2xl bg-muted px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">Send to my phone</span>
                  <Button variant="outline" size="sm" onPress={() => setQr(!qr)}>
                    {qr ? "Hide the QR code" : "Show a QR code"}
                  </Button>
                </div>
                {qr && (
                  <div className="flex flex-wrap items-center gap-4">
                    <Qr text={links.full} />
                    <p className="max-w-xs text-muted-foreground">
                      Scan it with your phone's camera. The plan opens in your phone's browser, with no account. In this prototype the link points to
                      this computer.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
