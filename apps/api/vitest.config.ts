import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Each test file gets a fresh module graph — avoids stale mock state
    // bleeding across files when we override R2/sharp/redis.
    isolate: true,
    testTimeout: 15_000,
  },
});
