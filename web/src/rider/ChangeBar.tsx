/**
 * What a change does (11.7): before one of a call's options is taken, a preview with Apply and Discard; after any
 * change, one line with Undo. Every line comes from `planChanges`.
 */
import type { PlanChanges } from "@dpg/planner";

interface Props {
  preview: { label: string; changes: PlanChanges | null } | null;
  last: { undone: boolean; changes: PlanChanges } | null;
  canUndo: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onHide: () => void;
}

function AllChanges({ lines }: { lines: string[] }) {
  if (lines.length <= 2) return null;
  return (
    <details className="all-changes">
      <summary>All changes</summary>
      <ul>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

export function ChangeBar({ preview, last, canUndo, onApply, onDiscard, onUndo, onHide }: Props) {
  if (preview) {
    const c = preview.changes;
    return (
      <div className="change-bar preview" role="status">
        <div className="change-text">
          <b>Preview: {preview.label}.</b> {c?.summary || "The days stay as they are."}
          {c && <AllChanges lines={c.lines} />}
        </div>
        <div className="change-actions">
          <button type="button" className="primary" onClick={onApply}>
            Apply
          </button>
          <button type="button" onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>
    );
  }
  if (!last) return null;
  return (
    <div className="change-bar" role="status">
      <div className="change-text">
        {last.undone ? "Undone: " : "Changed: "}
        {last.changes.summary}
        <AllChanges lines={last.changes.lines} />
      </div>
      <div className="change-actions">
        {!last.undone && canUndo && (
          <button type="button" className="link" onClick={onUndo}>
            Undo
          </button>
        )}
        <button type="button" className="link" onClick={onHide} aria-label="Hide this line">
          ×
        </button>
      </div>
    </div>
  );
}
