/**
 * What a change does (11.7), in the new UI kit (D53): a preview with Apply and Discard before a change is taken, and
 * one line with Undo after it. The wording comes from the planner's `planChanges`.
 */
import { Undo2, X } from "lucide-react"
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
}

export function ChangeBar({ mode, label, summary, lines = [], onApply, onDiscard, onUndo, onHide }: ChangeBarProps) {
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
