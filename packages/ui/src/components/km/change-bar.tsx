/**
 * What a change does (11.7), in the new UI kit (D53): a preview with Apply and Discard before a change is taken, and
 * one line with Undo after it. The wording comes from the planner's `planChanges`. After a change, a second thought
 * may follow (D77): a question about a choice that is allowed but unusual, with ways to change it and a way to keep it.
 */
import { CircleHelp, Undo2, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@dpg/ui/components/ui/button"

export interface ChangeBarProps {
  mode: "preview" | "changed" | "undone"
  /** The option being previewed, e.g. "Add a day". */
  label?: string
  summary: string
  lines?: string[]
  onApply?: () => void
  onDiscard?: () => void
  onUndo?: () => void
  onHide?: () => void
  /** A second thought about the change just made (D77), from the planner's `secondThoughts`. */
  thought?: {
    question: string
    why: string
    /** Ways to change it; each is previewed before it applies. */
    options: { label: string; onPress: () => void }[]
    /** Keeping it as it is, e.g. "Keep both". */
    keep: string
    onKeep: () => void
  }
}

export function ChangeBar({ mode, label, summary, lines = [], onApply, onDiscard, onUndo, onHide, thought }: ChangeBarProps) {
  const preview = mode === "preview"
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 border-b px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between",
        preview ? "border-primary/40 bg-primary/10" : "bg-card",
      )}
    >
      <div className="grid gap-1">
        <p>
          {preview ? <b>Preview: {label}. </b> : <span className="text-muted-foreground">{mode === "undone" ? "Undone: " : "Changed: "}</span>}
          {summary}
        </p>
        {lines.length > 2 && (
          <details>
            <summary className="cursor-pointer text-primary">All changes</summary>
            <ul className="mt-1 list-disc pl-5">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        )}
        {thought && !preview && (
          <div className="mt-1 grid gap-2 rounded-lg bg-muted px-3 py-2">
            <p className="flex gap-2">
              <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <b>{thought.question}</b> {thought.why}
              </span>
            </p>
            <div className="flex flex-wrap gap-2 pl-6">
              {thought.options.map((o) => (
                <Button key={o.label} variant="outline" size="sm" onPress={o.onPress}>
                  {o.label}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onPress={thought.onKeep}>
                {thought.keep}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {preview ? (
          <>
            <Button onPress={onApply}>Apply</Button>
            <Button variant="outline" onPress={onDiscard}>
              Discard
            </Button>
          </>
        ) : (
          <>
            {mode === "changed" && (
              <Button variant="ghost" size="sm" onPress={onUndo}>
                <Undo2 data-icon="inline-start" /> Undo
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onPress={onHide} aria-label="Hide this line">
              <X />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
