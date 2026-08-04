import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
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
});
