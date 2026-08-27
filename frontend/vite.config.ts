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
  // loadEnv("", projectRoot) reads unprefixed keys for server config only. Do not set
  // `envDir`: that would leak OPENAI_API_KEY from the root .env into the client.
  const env = loadEnv(mode, projectRoot, "");
  const uiPort = envPort(env.DATAFORGE_UI_PORT, DEFAULT_UI_PORT);
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
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          configure: (proxy) => {
            // Uvicorn reloads drop the API briefly; answer with a detail-less 503 so
            // parseApiError maps to "Backend unreachable" instead of Vite's empty 500.
            proxy.on("error", (_err, _req, res) => {
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
