import { defineConfig } from "vitest/config";

// Plain Node environment: tests inject a fake ChatProvider, so nothing hits the
// network. The OpenRouter provider uses global fetch, which Node 18+ provides,
// so a real-E2E test can run here too when given a key.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
