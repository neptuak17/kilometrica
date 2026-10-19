import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // The kit's styles (@dpg/ui/theme.css), so the site looks like Dream and Plan (D53, D56).
  plugins: [tailwindcss()],
  // Relative links, so the page works at kilometrica.com and at its github.io address under /kilometrica/.
  base: "./",
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
});
