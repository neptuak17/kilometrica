import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Tailwind only touches stylesheets that import it: the shadcn kit's (src/ui/theme.css), loaded on /ui (D53).
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // MapLibre's worker is bundled as an ES module worker (see src/maplibre-worker.ts).
  worker: { format: "es" },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/v1": "http://127.0.0.1:8787" },
  },
});
