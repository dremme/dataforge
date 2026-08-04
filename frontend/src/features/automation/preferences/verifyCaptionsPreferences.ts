import { putJson, requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";
import { normalizeFolderPath } from "@/features/browse/lib/folderPath";
import type { AutomationMode, VerifyCaptionsSettingsUpdate } from "@/shared/types";

export type VerifyCaptionsMode = AutomationMode;

export interface VerifyCaptionsSettings {
  mode: VerifyCaptionsMode;
  context: string;
  folderPath: string;
}

const DEFAULT_MODE: VerifyCaptionsMode = "instruct";

type VerifyCaptionsSettingsApi = {
  mode: VerifyCaptionsMode;
  context: string;
  folder_path?: string;
};

function isVerifyCaptionsMode(value: unknown): value is VerifyCaptionsMode {
  return value === "thinking" || value === "instruct";
}

function parseMode(value: unknown): VerifyCaptionsMode {
  return isVerifyCaptionsMode(value) ? value : DEFAULT_MODE;
}

function parseSettings(
  data: VerifyCaptionsSettingsApi,
  folderPath: string,
): VerifyCaptionsSettings {
  const normalized = normalizeFolderPath(folderPath);
  return {
    mode: parseMode(data.mode),
    context: typeof data.context === "string" ? data.context : "",
    folderPath:
      typeof data.folder_path === "string" && data.folder_path ? data.folder_path : normalized,
  };
}

export function emptyVerifyCaptionsSettings(folderPath: string): VerifyCaptionsSettings {
  return {
    mode: DEFAULT_MODE,
    context: "",
    folderPath: normalizeFolderPath(folderPath),
  };
}

async function fetchVerifyCaptionsSettings(folderPath: string): Promise<VerifyCaptionsSettings> {
  const params = new URLSearchParams({ path: folderPath });
  const data = await requestJson<VerifyCaptionsSettingsApi>(
    `/api/preferences/verify-captions?${params}`,
  );
  return parseSettings(data, folderPath);
}

export async function loadVerifyCaptionsSettings(
  folderPath: string,
): Promise<VerifyCaptionsSettings> {
  try {
    return await withRetry(() => fetchVerifyCaptionsSettings(folderPath));
  } catch {
    return emptyVerifyCaptionsSettings(folderPath);
  }
}

export async function updateVerifyCaptionsSettings(
  folderPath: string,
  partial: { mode?: VerifyCaptionsMode; context?: string },
): Promise<VerifyCaptionsSettings> {
  const body: VerifyCaptionsSettingsUpdate = {
    mode: partial.mode,
    context: partial.context,
    folder_path: folderPath,
  };
  const data = await putJson<VerifyCaptionsSettingsApi>("/api/preferences/verify-captions", body);
  return parseSettings(data, folderPath);
}
