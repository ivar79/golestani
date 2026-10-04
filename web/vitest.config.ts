import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config — logic tests run in node (no DOM, no Next.js runtime);
 * component tests opt into a real DOM per-file with
 * `// @vitest-environment jsdom` at the top of the file.
 * The `@/*` alias mirrors tsconfig.json so lib imports resolve.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
