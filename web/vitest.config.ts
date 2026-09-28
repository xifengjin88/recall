import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't load the React Router plugin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["app/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
