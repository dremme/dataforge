import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterEach, expect, it, vi } from "vitest";

let server: ViteDevServer | undefined;
let root: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

it("transforms the completed module when a formatter truncates and rewrites it", async () => {
  root = await mkdtemp(path.join(tmpdir(), "vite-rewrite-"));
  const file = path.join(root, "sample.ts");
  await writeFile(file, 'export const label = "landscape";');
  const transformed: string[] = [];
  server = await createServer({
    configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
    root,
    logLevel: "silent",
    server: { port: 0, strictPort: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "observe-reload-transforms",
        async handleHotUpdate(context) {
          if (context.file !== file.replaceAll("\\", "/")) return;
          const result = await context.server.transformRequest("/sample.ts");
          transformed.push(result?.code ?? "");
        },
      },
    ],
  });
  await once(server.watcher, "ready");
  expect((await server.transformRequest("/sample.ts"))?.code).toContain("landscape");

  await writeFile(file, "");
  await delay(100);
  await writeFile(file, 'export const label = "mountain";');

  await vi.waitFor(() => expect(transformed.length).toBeGreaterThan(0));
  expect(transformed[0]).toContain("mountain");
  expect((await server.transformRequest("/sample.ts"))?.code).toContain("mountain");

  transformed.length = 0;
  await writeFile(file, "");
  await vi.waitFor(() => expect(transformed).toEqual([""]));
  expect((await server.transformRequest("/sample.ts"))?.code).toBe("");
});
