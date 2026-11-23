import { THEME_SCRIPT } from "@mbs/ui/theme-script";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routeFileIgnorePattern: String.raw`\.test\.`,
      quoteStyle: "double",
      semicolons: true,
      addExtensions: true,
    }),
    react({ compiler: true }),
    tailwindcss(),
    {
      name: "theme-script",
      transformIndexHtml: () => [{ tag: "script", children: THEME_SCRIPT, injectTo: "head" }],
    },
  ],
  // Every file keeps its own URL, so the CSP needs no `data:`.
  build: { assetsInlineLimit: 0 },
  server: {
    port: 5174,
    strictPort: true,
    // Mirrors production: Caddy serves this app and sends /api to the API. The
    // app's own host has to survive, because the API picks the sign-in
    // instance from it.
    proxy: { "/api": { target: apiOrigin, changeOrigin: false } },
  },
  test: { environment: "jsdom", setupFiles: "./test/setup.ts" },
});
