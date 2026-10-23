/**
 * The UI kit at a glance (D53), at /ui: the shadcn preset (b7DMvgbTc: Rhea style, Mist neutrals, Teal, Inter, React
 * Aria), Kilometrica's purpose-named tokens, the standard components, and our own pieces with sample data.
 * It is the page to check the look on, and what Claude Design reads from the code. The rider pages don't use it yet.
 */
import { Bike, Info, Map, Moon, Sun } from "lucide-react"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import "@dpg/ui/theme.css"

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChangeBar,
  Checkbox,
  DayRow,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type Effort,
  EffortChart,
  ElevationProfile,
  Input,
  Label,
  Popover,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  StretchCard,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipTrigger,
} from "@dpg/ui"

const SWATCHES: [string, string][] = [
  ["Background", "bg-background"],
  ["Card", "bg-card"],
  ["Muted", "bg-muted"],
  ["Primary", "bg-primary"],
  ["Secondary", "bg-secondary"],
  ["Accent", "bg-accent"],
  ["Destructive", "bg-destructive"],
  ["Border", "bg-border"],
]

const OURS: [string, string, string][] = [
  ["Heads-up", "bg-headsup", "something to know or watch"],
  ["Highlight", "bg-highlight", "a reason it fits, a sight"],
  ["Unknown", "bg-unknown", "no data: check yourself"],
  ["Within level", "bg-effort-within", "a day within your level"],
  ["Harder", "bg-effort-harder", "a harder day"],
  ["Beyond", "bg-effort-beyond", "beyond your selected level"],
  ["Route", "bg-route", "the route on the map"],
  ["Chosen", "bg-route-chosen", "the stretch or day you chose"],
]

const DAYS: { number: number; date: string; to: string; km?: string; hours?: string; effort?: Effort; items?: number; rest?: boolean }[] = [
  { number: 1, date: "15/05", to: "Cullera", km: "62", hours: "4 h 05", effort: "within", items: 3 },
  { number: 2, date: "16/05", to: "Dénia", km: "71", hours: "4 h 40", effort: "within", items: 2 },
  { number: 3, date: "17/05", to: "Dénia", rest: true },
  { number: 4, date: "18/05", to: "Altea", km: "58", hours: "5 h 10", effort: "harder", items: 4 },
  { number: 5, date: "19/05", to: "Alacant / Alicante", km: "96", hours: "7 h 25", effort: "beyond", items: 5 },
]

// Made-up figures, for the look only: hours per day, and a rolling coast with one climb and an unknown stretch.
const EFFORT_DAYS: { day: number; hours: number; label: string; effort: Effort; rest?: boolean }[] = [
  { day: 1, hours: 4.08, label: "4 h 05", effort: "within" },
  { day: 2, hours: 4.67, label: "4 h 40", effort: "within" },
  { day: 3, hours: 5.17, label: "5 h 10", effort: "harder" },
  { day: 4, hours: 0, label: "Rest", effort: "within", rest: true },
  { day: 5, hours: 3.3, label: "3 h 20", effort: "within" },
  { day: 6, hours: 7.42, label: "7 h 25", effort: "beyond" },
]
const PROFILE = Array.from({ length: 301 }, (_, i) => {
  const km = i
  const m = 20 + 30 * Math.sin(km / 9) ** 2 + (km > 150 && km < 190 ? 380 * Math.sin(((km - 150) / 40) * Math.PI) : 0)
  return { km, m: km > 210 && km < 222 ? null : Math.round(m) }
})
const PROFILE_DAYS = [0, 62, 133, 191, 249, 300]

function Section({ title, children, note }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function Preview() {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false)
  const [picked, setPicked] = useState<number | null>(2)
  const [compare, setCompare] = useState<number[]>([])
  const [bar, setBar] = useState<"preview" | "changed" | "undone" | null>("preview")
  const [selectedDay, setSelectedDay] = useState(4)

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background font-sans text-foreground antialiased">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur">
          <span className="font-heading text-lg font-bold tracking-tight">Kilometrica</span>
          <span className="text-sm text-muted-foreground">UI kit</span>
          <span className="flex-1" />
          <Badge variant="outline">preset b7DMvgbTc</Badge>
          <Button variant="outline" size="icon-sm" onPress={() => setDark(!dark)} aria-label={dark ? "Light mode" : "Dark mode"}>
            {dark ? <Sun /> : <Moon />}
          </Button>
        </header>

        {bar && (
          <ChangeBar
            mode={bar}
            label="Add a day"
            summary="One riding day more (6); day 5 now ends at Benidorm, 74 km (was Alacant / Alicante, 96 km); and 2 more changes"
            lines={[
              "One riding day more (6)",
              "Day 5 now ends at Benidorm, 74 km (was Alacant / Alicante, 96 km)",
              "Days 6 change too",
              "Settles: Day 5 is beyond Moderate: 96 km, 1,140 m",
            ]}
            onApply={() => setBar("changed")}
            onDiscard={() => setBar(null)}
            onUndo={() => setBar("undone")}
            onHide={() => setBar(null)}
          />
        )}

        <main className="mx-auto grid max-w-5xl gap-10 px-4 py-8">
          <p className="max-w-2xl text-muted-foreground">
            The shadcn preset from shadcn/create (Rhea style, Mist neutrals, Teal, Inter, on React Aria) with Kilometrica's own
            purpose-named colours. Switch to dark mode with the button at the top. Nothing on the rider pages uses this yet.
          </p>

          <Section title="Colours" note="The preset's colours, then ours: named by what they mean, so a partner can re-skin them.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SWATCHES.map(([name, cls]) => (
                <div key={name} className="grid gap-1.5">
                  <div className={`h-12 rounded-xl ring-1 ring-foreground/10 ${cls}`} />
                  <span className="text-sm">{name}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {OURS.map(([name, cls, use]) => (
                <div key={name} className="grid gap-1.5">
                  <div className={`h-12 rounded-xl ring-1 ring-foreground/10 ${cls}`} />
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-xs text-muted-foreground">{use}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Type" note="Inter, from the preset.">
            <div className="grid gap-2">
              <h1 className="font-heading text-3xl font-bold tracking-tight">Valencia → El Vendrell</h1>
              <h3 className="font-heading text-xl font-semibold">7 days · 344 km · 49 km a day</h3>
              <p className="max-w-2xl">
                Mostly cycle paths along the coast, flat, with old towns to stop in. Best in May. Water and food every few
                kilometres; one busy stretch into Tarragona.
              </p>
              <p className="text-sm text-muted-foreground">From the audit of EuroVelo 8: OpenStreetMap, Overture and Copernicus climate.</p>
            </div>
          </Section>

          <Section title="Buttons and badges">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Plan this</Button>
              <Button variant="secondary">Pin to compare</Button>
              <Button variant="outline">Change</Button>
              <Button variant="ghost">Show 5 more</Button>
              <Button variant="destructive">Delete plan</Button>
              <Button variant="link">See day 3</Button>
              <Button size="icon" aria-label="Map">
                <Map />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Trip Pass</Badge>
              <Badge variant="secondary">7 days</Badge>
              <Badge variant="outline">Moderate</Badge>
              <Badge variant="destructive">Beyond your level</Badge>
              <Badge className="bg-headsup text-black">Heads-up</Badge>
              <Badge className="bg-highlight text-white">Highlight</Badge>
              <Badge className="bg-unknown text-unknown-foreground">No data</Badge>
            </div>
          </Section>

          <Section title="Questions" note="How the rider answers: Dream's chips and Plan's questions would use these.">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField className="grid gap-1.5" defaultValue="2027-05-15">
                <Label>Start date</Label>
                <Input type="date" />
              </TextField>
              <div className="grid gap-1.5">
                <Label>Level</Label>
                <Select aria-label="Level" defaultSelectedKey="3">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem id="1">Leisurely</SelectItem>
                    <SelectItem id="2">Easy-moderate</SelectItem>
                    <SelectItem id="3">Moderate</SelectItem>
                    <SelectItem id="4">Challenging</SelectItem>
                    <SelectItem id="5">Tough</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>How you sleep</Label>
                <ToggleGroup selectionMode="single" defaultSelectedKeys={["rooms"]} variant="outline" spacing={0} aria-label="How you sleep">
                  <ToggleGroupItem id="rooms">Rooms</ToggleGroupItem>
                  <ToggleGroupItem id="camping">Camping</ToggleGroupItem>
                  <ToggleGroupItem id="either">Either</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="grid content-start gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <Switch id="train" defaultSelected />
                  <Label htmlFor="train">Train at both ends</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="busy" />
                  <Label htmlFor="busy">Avoid busy roads</Label>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Dream: stretches" note="Our StretchCard, with sample data. Click a name to choose it; tick Compare.">
            <div className="grid gap-4 md:grid-cols-2">
              {[
                {
                  name: "Valencia → El Vendrell",
                  facts: "7 days · 344 km · 49 km a day · ↑ 285 m a day · Easy-moderate",
                  when: "Best in May: best-time 87 of 100",
                  why: ["Coast & beaches: strong here", "Villages & heritage: strong here"],
                  watch: ["steepest 500 m at 11%", "4 audit warnings: details with a Trip Pass"],
                  checks: ["14 of 120 places to stay publish no opening season: check dates ahead.", "Climbing is unknown for 2.1 km of this stretch."],
                },
                {
                  name: "Alcossebre → Blanes",
                  facts: "7 days · 356 km · 51 km a day · ↑ 374 m a day · Easy-moderate",
                  when: "Best in May: best-time 85 of 100",
                  why: ["Coast & beaches: strong here"],
                  watch: ["14 km on busy roads", "steepest 500 m at 19%"],
                  checks: ["No climate data for part of this stretch."],
                },
              ].map((s, i) => (
                <StretchCard
                  key={s.name}
                  rank={i + 1}
                  {...s}
                  chosen={picked === i + 1}
                  comparing={compare.includes(i + 1)}
                  onPick={() => setPicked(picked === i + 1 ? null : i + 1)}
                  onCompare={(on) => setCompare((c) => (on ? [...c, i + 1] : c.filter((x) => x !== i + 1)))}
                  planHref="#plan"
                />
              ))}
            </div>
          </Section>

          <Section title="Plan: the days" note="Our DayRow. Days a previewed change alters get a mark on the left (day 5 here).">
            <Card size="sm">
              <CardContent className="grid gap-0.5 px-2">
                {DAYS.map((d) => (
                  <DayRow key={d.number} {...d} selected={selectedDay === d.number} changed={d.number === 5} onPick={() => setSelectedDay(d.number)} />
                ))}
              </CardContent>
            </Card>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onPress={() => setBar("preview")}>
                Show the preview bar
              </Button>
              <Button variant="outline" size="sm" onPress={() => setBar("changed")}>
                Show the "Changed" line
              </Button>
            </div>
          </Section>

          <Section title="Plan: effort and elevation" note="Our EffortChart and ElevationProfile, with made-up figures. The line breaks where the terrain is unknown; night 2 is a kept night (orange). In Plan the nights can be dragged.">
            <Card>
              <CardContent>
                <EffortChart days={EFFORT_DAYS} usual={4.5} usualLabel="Your usual day at Moderate, about 4 h 30" selected={selectedDay} onPick={setSelectedDay} />
              </CardContent>
            </Card>
            <Card className="py-3">
              <ElevationProfile
                label="Elevation along the trip"
                points={PROFILE}
                spans={PROFILE_DAYS.slice(1).map((to, i) => ({ from: PROFILE_DAYS[i]!, to, label: `Day ${i + 1}` }))}
                markers={PROFILE_DAYS.slice(1, -1).map((km, i) => ({ km, label: String(i + 1), title: `Night ${i + 1}`, kept: i === 1 }))}
                onSpanPick={(i) => setSelectedDay(i + 1)}
                className="px-4"
              />
            </Card>
            <Card className="py-3">
              <ElevationProfile label="Elevation for day 3" tone="chosen" points={PROFILE.slice(133, 192).map((p) => ({ ...p, km: p.km - 133 }))} className="px-4" />
            </Card>
          </Section>

          <Section title="Cards, alerts and tables">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bike className="size-4" /> Ready to go
                  </CardTitle>
                  <CardDescription>Accommodation every night, every day within your level, 4 checks before you leave.</CardDescription>
                </CardHeader>
                <CardContent className="text-sm">
                  <p>
                    <b>Can I do it?</b> Yes, at Moderate, with 1 harder day. Day 5 is the hardest: 96 km, about 7 h 25 riding.
                  </p>
                </CardContent>
              </Card>
              <div className="grid content-start gap-3">
                <Alert>
                  <Info />
                  <AlertTitle>Some places didn't load for days 15–21</AlertTitle>
                  <AlertDescription>Water, food and places to stay may be missing there.</AlertDescription>
                </Alert>
                <Alert variant="destructive">
                  <Info />
                  <AlertTitle>Day 5 is beyond your selected level</AlertTitle>
                  <AlertDescription>96 km and 1,140 m against your usual 65 km.</AlertDescription>
                </Alert>
              </div>
            </div>
            <Table aria-label="Two stretches side by side">
              <TableHeader>
                <TableHead isRowHeader>Side by side</TableHead>
                <TableHead>Valencia → El Vendrell</TableHead>
                <TableHead>Alcossebre → Blanes</TableHead>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Days</TableCell>
                  <TableCell>7 · 344 km · 49 km a day</TableCell>
                  <TableCell>7 · 356 km · 51 km a day</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Busy roads</TableCell>
                  <TableCell>1%</TableCell>
                  <TableCell>4%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Trains</TableCell>
                  <TableCell>València · el Vendrell</TableCell>
                  <TableCell>Alcalà de Xivert · Blanes</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Section>

          <Section title="Tabs, dialogs, popovers and tooltips">
            <Tabs defaultSelectedKey="dream">
              <TabsList>
                <TabsTrigger id="dream">Dream</TabsTrigger>
                <TabsTrigger id="plan">Plan</TabsTrigger>
                <TabsTrigger id="go">Go</TabsTrigger>
              </TabsList>
              <TabsContent id="dream" className="text-muted-foreground">
                Which stretch suits you, when, and which way.
              </TabsContent>
              <TabsContent id="plan" className="text-muted-foreground">
                Days, nights and the calls only you can make.
              </TabsContent>
              <TabsContent id="go" className="text-muted-foreground">
                Your plan at a glance, on the road.
              </TabsContent>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              <DialogTrigger>
                <Button variant="outline">Share this plan</Button>
                <Dialog>
                  <DialogHeader>
                    <DialogTitle>Share this plan</DialogTitle>
                    <DialogDescription>A read-only link: the full plan, or dates and stops only.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose>Close</DialogClose>
                  </DialogFooter>
                </Dialog>
              </DialogTrigger>
              <PopoverTrigger>
                <Button variant="outline">How well we know these days</Button>
                <Popover>
                  <p className="text-sm">Surfaces known for 97% of the way; opening dates for 12% of the beds at your stops.</p>
                </Popover>
              </PopoverTrigger>
              <TooltipTrigger>
                <Button variant="ghost">Hover me</Button>
                <Tooltip>Your usual day: about 4 h 25 riding</Tooltip>
              </TooltipTrigger>
            </div>
          </Section>

          <Separator />
          <p className="text-xs text-muted-foreground">
            Kilometrica UI kit · shadcn/ui on React Aria (D53) · the <code>@dpg/ui</code> package: components in{" "}
            <code>packages/ui/src/components</code>, colours in <code>packages/ui/src/styles</code>.
          </p>
        </main>
      </div>
    </div>
  )
}

export function mount(root: HTMLElement) {
  document.title = "Kilometrica UI kit"
  createRoot(root).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  )
}
