import { defineConfig } from "vitest/config";
import path from "node:path";

// Override docker-network hostnames with localhost so host-side tests can hit
// the postgres + redis containers via their published ports.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/holiday_delight_crm";
process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? "redis://localhost:6379";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15000,
    // Spam-layer tests share a single Postgres + Redis instance and use
    // tenant-scoped data isolation. Running test files in parallel would let
    // one file's `redis.flushdb()` clobber another's keys mid-test, so we
    // serialise file execution. Tests within a file still run in order.
    fileParallelism: false,
    // Exclude .tsx component tests — they run under vitest.ui.config.ts.
    // The snippet template .test.ts is NOT excluded here — its node-compatible
    // token-substitution describe block runs under this config.  The browser
    // describe block in the same file uses vi.skipIf to skip when document is
    // not available (node environment).
    exclude: [
      "node_modules",
      "dist",
      "src/**/*.test.tsx",
    ],
  },
});
