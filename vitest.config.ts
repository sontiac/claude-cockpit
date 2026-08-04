import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Agent worktrees under .claude/ carry a full copy of the repo — without
    // this exclude the root suite double-runs every test file inside them.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
