/**
 * vitest.ui.config.ts
 *
 * Vitest configuration for UI/browser-environment tests.
 *
 * Runs tests that require jsdom:
 *   - React component page tests (src/app/(dashboard)/settings/.../*.test.tsx)
 *   - Browser IIFE runtime tests (src/lib/snippet/template.test.ts — browser block)
 *
 * Node-environment tests remain in the default vitest.config.ts.
 *
 * Usage:
 *   npx vitest run --config vitest.ui.config.ts
 *
 * Requires: jsdom installed as a devDependency (npm install --save-dev jsdom)
 * See TODO_BLOCKERS B1 / B4 for history.
 */

import { defineConfig } from "vitest/config";
import path from "node:path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Include React component tests (.tsx) and the browser-runtime snippet test.
    // The snippet template test is a .ts file but contains browser-environment
    // tests — it is explicitly included here and explicitly excluded from the
    // default node config (vitest.config.ts adds it to exclude).
    include: [
      "src/**/*.test.tsx",
      "src/lib/snippet/template.test.ts",
    ],
    // Do not exclude .ts files globally here — include takes precedence for
    // explicitly listed files.  The node-config tests are simply not matched
    // by this config's include patterns (they are .test.ts but not .test.tsx
    // and not the snippet template).
    exclude: [
      "node_modules",
      "dist",
    ],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
