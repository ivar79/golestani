import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config — unit tests only (no DOM, no Next.js runtime).
 * The `@/*` alias mirrors tsconfig.json so lib imports resolve.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
