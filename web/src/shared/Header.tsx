/**
 * The rider views' header in the new look (D53, D54): the name, Dream and Plan, and whatever the page adds on the
 * right. No logo until a mark is cleared (D42), so the name is set in Inter.
 */
import { cn } from "@dpg/ui";
import type { ReactNode } from "react";

export function Header({ phase, dreamHref = "/dream", planHref = "/plan", children }: {
  phase: "dream" | "plan";
  dreamHref?: string;
  planHref?: string;
  /** The right-hand side: the route, buttons. */
  children?: ReactNode;
}) {
  const tab = (id: "dream" | "plan", label: string, href: string) => (
    <a
      href={href}
      aria-current={phase === id ? "page" : undefined}
      className={cn(
        "rounded-full px-3 py-1.5 no-underline transition-colors",
        phase === id ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </a>
  );
  return (
    <header className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b px-4 py-3 sm:px-8">
      <a href="/dream" className="text-lg font-semibold tracking-tight text-foreground no-underline">
        Kilometrica
      </a>
      <nav aria-label="Phases" className="flex gap-1">
        {tab("dream", "Dream", dreamHref)}
        {tab("plan", "Plan", planHref)}
      </nav>
      <div className="flex-1" />
      {children}
    </header>
  );
}
