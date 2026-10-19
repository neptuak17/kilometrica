/** A part of the plan that comes with the Trip Pass (D45), shown calmly: what it is and that it's there, never a nag. */
import { Icons } from "@dpg/ui";
import type { ReactNode } from "react";

export function Locked({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5 rounded-3xl border border-dashed px-5 py-4 text-muted-foreground">
      <h2 className="flex items-center gap-2 font-semibold text-foreground">
        <Icons.Lock className="size-4" aria-hidden="true" />
        {title}
      </h2>
      <p>{children}</p>
    </section>
  );
}
