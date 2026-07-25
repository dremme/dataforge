import { requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";

export type VerifyCaptionsMode = "thinking" | "instruct";

export interface VerifyCaptionsSettings {
  mode: VerifyCaptionsMode;
  context: string;
}

const VERIFY_CAPTIONS_CACHE_KEY = "verify-captions-settings";

const EMPTY_SETTINGS: VerifyCaptionsSettings = {
  mode: "instruct",
  context: "",
};

type VerifyCaptionsSettingsApi = {
  mode: VerifyCaptionsMode;
  context: string;
};

function isVerifyCaptionsMode(value: unknown): value is VerifyCaptionsMode {
  return value === "thinking" || value === "instruct";
}

function parseSettings(data: VerifyCaptionsSettingsApi): VerifyCaptionsSettings {
  return {
    mode: isVerifyCaptionsMode(data.mode) ? data.mode : "instruct",
    context: data.context,
  };
}

export function readCachedVerifyCaptionsSettings(): VerifyCaptionsSettings | null {
  try {
    const stored = localStorage.getItem(VERIFY_CAPTIONS_CACHE_KEY);
    if (!stored) return null;

    const data = JSON.parse(stored) as unknown;
    if (typeof data !== "object" || data === null) return null;

    const record = data as Record<string, unknown>;
    return {
      mode: isVerifyCaptionsMode(record.mode) ? record.mode : "instruct",
      context: typeof record.context === "string" ? record.context : "",
    };
  } catch {
    return null;
  }
}

export function cacheVerifyCaptionsSettings(settings: VerifyCaptionsSettings): void {
  try {
    localStorage.setItem(VERIFY_CAPTIONS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage access errors
  }
}

async function fetchVerifyCaptionsSettings(): Promise<VerifyCaptionsSettings> {
  const data = await requestJson<VerifyCaptionsSettingsApi>("/api/preferences/verify-captions");
  const settings = parseSettings(data);
  cacheVerifyCaptionsSettings(settings);
  return settings;
}

export async function loadVerifyCaptionsSettings(): Promise<VerifyCaptionsSettings> {
  try {
    return await withRetry(fetchVerifyCaptionsSettings);
  } catch {
    return readCachedVerifyCaptionsSettings() ?? EMPTY_SETTINGS;
  }
}
