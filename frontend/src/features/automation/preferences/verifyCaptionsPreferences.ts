import { putJson, requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";
import { normalizeFolderPath } from "@/features/folder/lib/folderPath";
import type {
  AutomationMode,
  ReasoningEffort,
  VerifyCaptionsSettingsResponse,
  VerifyCaptionsSettingsUpdate,
} from "@/shared/types";

export type VerifyCaptionsMode = AutomationMode;

export interface VerifyCaptionsSettings {
  mode: VerifyCaptionsMode;
  reasoningEffort: ReasoningEffort;
  preserveThinking: boolean;
  context: string;
  folderPath: string;
}

const DEFAULT_MODE: VerifyCaptionsMode = "instruct";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
export const DEFAULT_PRESERVE_THINKING = true;

function isVerifyCaptionsMode(value: unknown): value is VerifyCaptionsMode {
  return value === "thinking" || value === "instruct";
}

function parseMode(value: unknown): VerifyCaptionsMode {
  return isVerifyCaptionsMode(value) ? value : DEFAULT_MODE;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "xhigh";
}

function parseEffort(value: unknown): ReasoningEffort {
  return isReasoningEffort(value) ? value : DEFAULT_REASONING_EFFORT;
}

function parseSettings(
  data: VerifyCaptionsSettingsResponse,
  folderPath: string,
): VerifyCaptionsSettings {
  const normalized = normalizeFolderPath(folderPath);
  return {
    mode: parseMode(data.mode),
    reasoningEffort: parseEffort(data.reasoning_effort),
    preserveThinking:
      typeof data.preserve_thinking === "boolean"
        ? data.preserve_thinking
        : DEFAULT_PRESERVE_THINKING,
    context: typeof data.context === "string" ? data.context : "",
    folderPath:
      typeof data.folder_path === "string" && data.folder_path ? data.folder_path : normalized,
  };
}

export function emptyVerifyCaptionsSettings(folderPath: string): VerifyCaptionsSettings {
  return {
    mode: DEFAULT_MODE,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    preserveThinking: DEFAULT_PRESERVE_THINKING,
    context: "",
    folderPath: normalizeFolderPath(folderPath),
  };
}

async function fetchVerifyCaptionsSettings(folderPath: string): Promise<VerifyCaptionsSettings> {
  const params = new URLSearchParams({ path: folderPath });
  const data = await requestJson<VerifyCaptionsSettingsResponse>(
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
  partial: {
    mode?: VerifyCaptionsMode;
    context?: string;
    reasoningEffort?: ReasoningEffort;
    preserveThinking?: boolean;
  },
): Promise<VerifyCaptionsSettings> {
  const body: VerifyCaptionsSettingsUpdate = {
    mode: partial.mode,
    reasoning_effort: partial.reasoningEffort,
    preserve_thinking: partial.preserveThinking,
    context: partial.context,
    folder_path: folderPath,
  };
  const data = await putJson<VerifyCaptionsSettingsResponse>(
    "/api/preferences/verify-captions",
    body,
  );
  return parseSettings(data, folderPath);
}
