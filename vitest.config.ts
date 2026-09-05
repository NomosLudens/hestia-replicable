import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "chama/**/*.test.js"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
