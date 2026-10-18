/**
 * Picks the page by its path and loads only that page's code and styles: /ui is the new UI kit (shadcn, D53), whose
 * Tailwind reset must not reach the current pages; everything else is the audit viewer or the rider view.
 */
const root = document.getElementById("root")!;
const path = window.location.pathname;

if (path.startsWith("/ui")) void import("./ui/preview").then((m) => m.mount(root));
else void import("./pages").then((m) => m.mount(root, path));
