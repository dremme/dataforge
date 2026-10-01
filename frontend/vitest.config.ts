import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const coverageDir = process.env.DATAFORGE_COVERAGE_DIR || undefined;

// Instrumentation slows every test by about half, enough to push the heaviest past the 5s default.
const COVERAGE_TEST_TIMEOUT = 20_000;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    css: true,
    testTimeout: coverageDir ? COVERAGE_TEST_TIMEOUT : undefined,
    coverage: {
      enabled: coverageDir !== undefined,
      provider: "v8",
      reportsDirectory: coverageDir && path.join(coverageDir, "frontend"),
      reporter: ["json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/test/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "dev-server",
          environment: "node",
          include: ["vite.test.ts"],
        },
      },
    ],
  },
});
