import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RUN_DIR_ENV = "DATAFORGE_E2E_RUN_DIR";
const PREFIX = "dataforge-e2e-";
/** scripts/e2e_backend.py refuses a run folder without it. */
const OWNER_MARKER = ".dataforge-e2e-owner";

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Deletes run folders whose owning process has exited; anything without a marker is not ours. */
function sweepFinishedRuns(tempDir: string) {
  for (const name of fs.readdirSync(tempDir)) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = path.join(tempDir, name);
    let owner: number;
    try {
      owner = Number(fs.readFileSync(path.join(dir, OWNER_MARKER), "utf-8"));
    } catch {
      continue;
    }
    if (!Number.isInteger(owner) || owner <= 0 || isRunning(owner)) continue;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * This run's own temp folder. The config's first load makes it and later loads, in the workers,
 * inherit it through the environment, so concurrent runs never share or delete fixtures. A
 * finished run's folder stays for inspection until the next run starts.
 */
export function runDirectory(): string {
  const existing = process.env[RUN_DIR_ENV];
  if (existing) return existing;
  const tempDir = os.tmpdir();
  sweepFinishedRuns(tempDir);
  const dir = fs.mkdtempSync(path.join(tempDir, PREFIX));
  fs.writeFileSync(path.join(dir, OWNER_MARKER), String(process.pid));
  process.env[RUN_DIR_ENV] = dir;
  return dir;
}
