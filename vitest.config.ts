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
  },
});
