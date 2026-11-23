/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Isolated Stage 2 renderer-bakeoff harness. Deliberately has no relationship
// to the main app's Next.js/Turbopack build — this is a throwaway prototype
// workspace per the bakeoff program rules.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5183,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
