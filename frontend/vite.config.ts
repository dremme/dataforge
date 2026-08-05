import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, "..");

const DEFAULT_UI_PORT = 8081;
const DEFAULT_API_PORT = 8080;

function envPort(raw: string | undefined, fallback: number): number {
  const port = Number(raw?.trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

export default defineConfig(({ mode }) => {
  // Read the project-root .env - the same file backend/env_file.py loads - so the
  // dev ports have one source of truth instead of a frontend copy that drifts.
  // The "" prefix opts into unprefixed keys; it is scoped to this call and never
  // reaches the browser, because envPrefix stays at its "VITE_" default and these
  // values are only used to build the server config below. For the same reason,
  // do not set a config-level `envDir`: that would repoint Vite's own client-env
  // scan at a root .env that holds OPENAI_API_KEY.
  const env = loadEnv(mode, projectRoot, "");
  const uiPort = envPort(env.DATAFORGE_UI_PORT, DEFAULT_UI_PORT);
  // The address Vite dials, not the one uvicorn binds - DATAFORGE_API_HOST can
  // widen the bind without changing this.
  const apiPort = envPort(env.DATAFORGE_API_PORT, DEFAULT_API_PORT);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "src"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: uiPort,
      // Falling forward to a free port would strand the launcher, which frees and
      // probes exactly this port and opens the browser on it.
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          // Vite applies this implicitly to string targets; keep it on the object
          // form so switching notation does not quietly change behavior.
          changeOrigin: true,
          configure: (proxy) => {
            // The API is down for a second or two on every uvicorn reload. Answer
            // those with a well-formed 503 instead of leaving it to Vite's generic
            // empty 500, which the client only reads correctly because its JSON
            // parse fails and falls back.
            //
            // The body must stay free of a `detail` field: parseApiError in
            // shared/api/http.ts maps a detail-less 5xx to "Backend unreachable"
            // but surfaces any `detail` string verbatim.
            //
            // configure() runs before Vite registers its own error handler, and
            // that one skips writing once headersSent - so this wins the response
            // while Vite still logs the failure.
            proxy.on("error", (_err, _req, res) => {
              // Also fires for WebSocket upgrades, where `res` is a raw Socket.
              if (!res || !("writeHead" in res) || res.headersSent || res.writableEnded) {
                return;
              }
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end("{}");
            });
          },
        },
      },
    },
  };
});
