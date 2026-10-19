/**
 * A part of the plan that comes with the Trip Pass (D45), shown calmly: what it is and that it's there, never a nag.
 * The icon set has no lock, so it's drawn here.
 */
import type { ReactNode } from "react";

export function LockIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function Locked({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5 rounded-3xl border border-dashed px-5 py-4 text-muted-foreground">
      <h2 className="flex items-center gap-2 font-semibold text-foreground">
        <LockIcon />
        {title}
      </h2>
      <p>{children}</p>
    </section>
  );
}
