import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, "..");

// Away from the 18080/18081 dev defaults, so a running dev instance is left alone.
const API_PORT = "18090";
const UI_PORT = "18091";

const workspace = path.join(os.tmpdir(), "dataforge-e2e");
const venvPython =
  process.platform === "win32"
    ? path.join(projectRoot, "backend", ".venv", "Scripts", "python.exe")
    : path.join(projectRoot, "backend", ".venv", "bin", "python");

const serverEnv = {
  DATAFORGE_API_PORT: API_PORT,
  DATAFORGE_UI_PORT: UI_PORT,
  DATAFORGE_E2E_WORKSPACE: workspace,
  DATAFORGE_DISABLE_DOTENV: "1",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: `"${venvPython}" "${path.join(projectRoot, "scripts", "e2e_backend.py")}"`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The dev server, not preview: vite.config.ts proxies /api under `server` only.
      command: "npm run dev",
      url: `http://127.0.0.1:${UI_PORT}`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
