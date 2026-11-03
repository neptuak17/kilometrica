/**
 * A town on the route, chosen from a searchable list in route order (D104): where a trip starts, ends or passes. Each
 * town shows its km and, where one is near, a train for a station that carries bikes. Typing finds a town by its own
 * name or its English one, without accents ("sete" finds Sète, "Corinth" finds Κόρινθος).
 */
import { Train } from "lucide-react"
import { cn } from "cn"
import { Autocomplete, ListBox, ListLayout, useFilter, Virtualizer } from "react-aria-components"

import { Select, SelectInput, SelectItem, SelectPopover, SelectTrigger, SelectValue } from "@dpg/ui/components/ui/select"

export interface Town {
  id: string
  name: string
  /** Its English name, where it differs: searched, and shown after the name. */
  alt?: string | null
  /** Where it is along the route. */
  km?: number
  /** A bike-carrying station near it, by name. */
  station?: string | null
}

export interface TownSelectProps {
  /** The field's name, for screen readers; the visible label sits outside, as for other fields. */
  label: string
  /** In route order. */
  towns: Town[]
  selected: string | null
  onSelect: (id: string | null) => void
  placeholder?: string
  /** Offer no town at all, e.g. "Any town". */
  anyLabel?: string
  isDisabled?: boolean
  className?: string
}

const ANY = "__any"
const nameOf = (t: Town) => (t.alt ? `${t.name} (${t.alt})` : t.name)

export function TownSelect({ label, towns, selected, onSelect, placeholder = "Choose a town…", anyLabel, isDisabled, className }: TownSelectProps) {
  const { contains } = useFilter({ sensitivity: "base" })
  const items = anyLabel ? [{ id: ANY, name: anyLabel } as Town, ...towns] : towns
  return (
    <Select
      aria-label={label}
      placeholder={placeholder}
      selectedKey={selected ?? (anyLabel ? ANY : null)}
      onSelectionChange={(k) => onSelect(k === null || k === ANY ? null : String(k))}
      isDisabled={isDisabled}
      className={cn("w-full min-w-0", className)}
    >
      <SelectTrigger className="w-full min-w-0">
        <SelectValue className="min-w-0">{({ selectedText, isPlaceholder }) => <span className="truncate">{isPlaceholder ? placeholder : selectedText}</span>}</SelectValue>
      </SelectTrigger>
      <SelectPopover className="min-w-64">
        <Autocomplete filter={contains}>
          <SelectInput aria-label={`Find a town for ${label.toLowerCase()}`} />
          {/* Long routes have over a thousand towns: only the rows in view are drawn. */}
          <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 32, padding: 4 }}>
            <ListBox
              items={items}
              className="max-h-72 overflow-y-auto outline-hidden"
              renderEmptyState={() => <p className="py-3 text-center text-sm text-muted-foreground">No town by that name on the route</p>}
            >
              {(t) => (
                <SelectItem id={t.id} textValue={nameOf(t)} className="mx-1">
                  <span className="min-w-0 flex-1 truncate">
                    {t.name}
                    {t.alt && <span className="text-muted-foreground"> ({t.alt})</span>}
                  </span>
                  {t.station && <Train role="img" aria-label={`Station: ${t.station}`} className="size-3.5 text-muted-foreground" />}
                  {t.km !== undefined && <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">km {Math.round(t.km).toLocaleString("en-GB")}</span>}
                </SelectItem>
              )}
            </ListBox>
          </Virtualizer>
        </Autocomplete>
      </SelectPopover>
    </Select>
  )
}
