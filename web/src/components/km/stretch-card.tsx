/**
 * A stretch in Dream (11.7), in the new UI kit (D53): its number, name and facts, why it fits, what to watch, what to
 * check yourself, and "Plan this". Unknowns are shown as unknown (D37).
 */
import { ArrowRight, Check, CircleHelp, TriangleAlert } from "lucide-react"
import { cn } from "cn"
import { useId } from "react"

import { Badge } from "@/components/ui/badge"
import { LinkButton } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export interface StretchCardProps {
  rank?: number
  name: string
  facts: string
  when?: string
  why: string[]
  watch: string[]
  checks: string[]
  chosen?: boolean
  comparing?: boolean
  planHref?: string
  onPick?: () => void
  onCompare?: (on: boolean) => void
}

export function StretchCard({ rank, name, facts, when, why, watch, checks, chosen, comparing, planHref, onPick, onCompare }: StretchCardProps) {
  const compareId = useId()
  return (
    <Card className={cn("gap-3", chosen && "ring-2 ring-route-chosen")}>
      <CardHeader>
        <CardTitle>
          <button type="button" onClick={onPick} aria-pressed={chosen} className="flex items-center gap-2 text-left text-base font-semibold">
            {rank !== undefined && <Badge className="size-6 rounded-full p-0">{rank}</Badge>}
            {name}
          </button>
        </CardTitle>
        <p className="text-sm text-foreground/80">{facts}</p>
        {when && <p className="text-sm text-muted-foreground">{when}</p>}
      </CardHeader>
      <CardContent className="grid gap-2">
        {why.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {why.map((w) => (
              <li key={w} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
        {watch.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {watch.map((w) => (
              <li key={w} className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-headsup" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
        {checks.length > 0 && (
          <details className="text-sm">
            <summary className="flex cursor-pointer items-center gap-2 text-unknown-foreground">
              <CircleHelp className="size-4 shrink-0" aria-hidden />
              {checks.length} {checks.length === 1 ? "thing" : "things"} to check yourself
            </summary>
            <ul className="mt-1 grid gap-1 pl-6 text-muted-foreground">
              {checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        {onCompare ? (
          <div className="flex items-center gap-2">
            <Checkbox id={compareId} isSelected={comparing} onChange={onCompare} />
            <Label htmlFor={compareId}>Compare</Label>
          </div>
        ) : (
          <span />
        )}
        {planHref && (
          <LinkButton href={planHref}>
            Plan this <ArrowRight data-icon="inline-end" />
          </LinkButton>
        )}
      </CardFooter>
    </Card>
  )
}
