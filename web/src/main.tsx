/**
 * Picks the page by its path and loads only that page's code and styles. /ui (the kit), /dream and /plan are in the
 * new look (shadcn, D53, D54), whose Tailwind reset must not reach the audit viewer, which keeps its own (D43).
 */
const root = document.getElementById("root")!;
const path = window.location.pathname;

if (path.startsWith("/ui")) void import("./ui/preview").then((m) => m.mount(root));
else if (path.startsWith("/dream")) void import("./dream/entry").then((m) => m.mount(root));
else if (path.startsWith("/plan")) void import("./rider/entry").then((m) => m.mount(root));
else void import("./pages").then((m) => m.mount(root));
