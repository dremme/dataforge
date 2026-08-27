import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";

const STORAGE_KEY = "dataforge:job-completion-notified";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type ClaimMap = Record<string, number>;

function parseClaimMap(value: unknown): ClaimMap | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result: ClaimMap = {};
  for (const [key, timestamp] of Object.entries(value)) {
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      result[key] = timestamp;
    }
  }
  return result;
}

function claimId(jobId: string, status: string): string {
  return `${jobId}:${status}`;
}

function pruneClaims(map: ClaimMap, nowMs: number): ClaimMap {
  const pruned: ClaimMap = {};
  for (const [key, timestamp] of Object.entries(map)) {
    if (nowMs - timestamp < MAX_AGE_MS) {
      pruned[key] = timestamp;
    }
  }
  return pruned;
}

export function claimJobCompletionNotification(
  jobId: string,
  status: string,
  nowMs: number = Date.now(),
): boolean {
  const existing = readStoredJson(STORAGE_KEY, parseClaimMap, {}, "local");
  const pruned = pruneClaims(existing, nowMs);
  const id = claimId(jobId, status);

  if (pruned[id] !== undefined) {
    if (Object.keys(pruned).length !== Object.keys(existing).length) {
      writeStoredJson(STORAGE_KEY, pruned, "local");
    }
    return false;
  }

  pruned[id] = nowMs;
  writeStoredJson(STORAGE_KEY, pruned, "local");
  return true;
}
