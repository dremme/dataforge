import type { AppSettingKey, AppSettingsResponse, AppSettingsUpdate } from "@/shared/types";

export type SettingKind = "url" | "text" | "integer" | "seconds";

export interface SettingField {
  label: string;
  kind: SettingKind;
  unit?: string;
}

export const SETTING_FIELDS: Record<AppSettingKey, SettingField> = {
  vision_base_url: { label: "Server URL", kind: "url" },
  vision_model: { label: "Model", kind: "text" },
  vision_timeout_seconds: { label: "Timeout", kind: "seconds", unit: "seconds" },
  draft_caption_threshold: { label: "Draft threshold", kind: "integer", unit: "characters" },
  comfy_base_url: { label: "ComfyUI URL", kind: "url" },
  ai_toolkit_base_url: { label: "AI-Toolkit URL", kind: "url" },
  thumbnail_cache_max_mb: { label: "Cache limit", kind: "integer", unit: "MB" },
};

const SETTING_KEYS = Object.keys(SETTING_FIELDS) as AppSettingKey[];

export interface SettingsDraft {
  values: Record<AppSettingKey, string>;
  resets: ReadonlySet<AppSettingKey>;
}

export function draftFromSettings(settings: AppSettingsResponse): SettingsDraft {
  const values = {} as Record<AppSettingKey, string>;
  for (const key of SETTING_KEYS) values[key] = String(settings[key].value);
  return { values, resets: new Set() };
}

export function editDraftValue(
  draft: SettingsDraft,
  key: AppSettingKey,
  value: string,
): SettingsDraft {
  const resets = new Set(draft.resets);
  resets.delete(key);
  return { values: { ...draft.values, [key]: value }, resets };
}

export function resetDraftValue(
  draft: SettingsDraft,
  settings: AppSettingsResponse,
  key: AppSettingKey,
): SettingsDraft {
  return {
    values: { ...draft.values, [key]: String(settings[key].fallback) },
    resets: new Set(draft.resets).add(key),
  };
}

export function isSettingEdited(
  settings: AppSettingsResponse,
  draft: SettingsDraft,
  key: AppSettingKey,
): boolean {
  return draft.resets.has(key) || draft.values[key] !== String(settings[key].value);
}

export function editedSettingKeys(
  settings: AppSettingsResponse,
  draft: SettingsDraft,
): AppSettingKey[] {
  return SETTING_KEYS.filter((key) => isSettingEdited(settings, draft, key));
}

const WHOLE_NUMBER = /^\d+$/;
const DECIMAL_NUMBER = /^\d+(\.\d+)?$/;

type ParsedValue = { value: string | number } | { error: string };

function parseValue(field: SettingField, raw: string): ParsedValue {
  const text = raw.trim();
  switch (field.kind) {
    case "integer":
      return WHOLE_NUMBER.test(text) ? { value: Number(text) } : { error: "a whole number" };
    case "seconds":
      return DECIMAL_NUMBER.test(text) ? { value: Number(text) } : { error: "a number of seconds" };
    case "url":
    case "text":
      return text ? { value: text } : { error: "a value" };
  }
}

export type DraftUpdate = { update: AppSettingsUpdate } | { key: AppSettingKey; error: string };

export function buildSettingsUpdate(
  settings: AppSettingsResponse,
  draft: SettingsDraft,
): DraftUpdate {
  const update: Record<string, string | number | AppSettingKey[]> = {};
  const reset: AppSettingKey[] = [];

  for (const key of SETTING_KEYS) {
    if (draft.resets.has(key)) {
      reset.push(key);
      continue;
    }
    if (!isSettingEdited(settings, draft, key)) continue;

    const field = SETTING_FIELDS[key];
    const parsed = parseValue(field, draft.values[key]);
    if ("error" in parsed) return { key, error: `${field.label} needs ${parsed.error}.` };
    update[key] = parsed.value;
  }

  if (reset.length) update.reset = reset;
  return { update: update as AppSettingsUpdate };
}
