import type { AppSettingKey, AppSettingsResponse, AppSettingsUpdate } from "@/shared/types";

export type SettingKind = "url" | "text" | "integer" | "decimal" | "secret";

export interface SettingField {
  label: string;
  kind: SettingKind;
  unit?: string;
  /** The label with its group, for messages shown away from the group heading. */
  fullLabel?: string;
  /** How far the arrow keys move a number. */
  step?: number;
}

function sampling(mode: "Reasoning" | "Instruct") {
  const field = (label: string, step: number): SettingField => ({
    label,
    kind: "decimal",
    fullLabel: `${mode} ${label.toLowerCase()}`,
    step,
  });
  return {
    temperature: field("Temperature", 0.05),
    top_p: field("Top-p", 0.01),
    min_p: field("Min-p", 0.01),
    presence_penalty: field("Presence penalty", 0.1),
    repeat_penalty: field("Repeat penalty", 0.05),
  };
}

const THINKING = sampling("Reasoning");
const INSTRUCT = sampling("Instruct");

export const SETTING_FIELDS: Record<AppSettingKey, SettingField> = {
  vision_base_url: { label: "Server URL", kind: "url" },
  vision_api_key: { label: "API key", kind: "secret" },
  vision_model: { label: "Model", kind: "text" },
  vision_max_tokens: { label: "Max tokens", kind: "integer" },
  vision_top_k: { label: "Top-k", kind: "integer" },
  draft_caption_threshold: { label: "Draft threshold", kind: "integer", unit: "chars" },
  thinking_temperature: THINKING.temperature,
  thinking_top_p: THINKING.top_p,
  thinking_min_p: THINKING.min_p,
  thinking_presence_penalty: THINKING.presence_penalty,
  thinking_repeat_penalty: THINKING.repeat_penalty,
  instruct_temperature: INSTRUCT.temperature,
  instruct_top_p: INSTRUCT.top_p,
  instruct_min_p: INSTRUCT.min_p,
  instruct_presence_penalty: INSTRUCT.presence_penalty,
  instruct_repeat_penalty: INSTRUCT.repeat_penalty,
  image_max_pixels: { label: "Pixel budget", kind: "integer", unit: "pixels" },
  video_keyframes_per_second: { label: "Keyframes", kind: "integer", unit: "per second" },
  video_max_keyframes: { label: "Max keyframes", kind: "integer", unit: "per video" },
  video_frame_max_pixels: { label: "Frame budget, short clips", kind: "integer", unit: "pixels" },
  video_frame_min_pixels: { label: "Frame budget, long clips", kind: "integer", unit: "pixels" },
  comfy_base_url: { label: "ComfyUI URL", kind: "url" },
  ai_toolkit_base_url: { label: "AI-Toolkit URL", kind: "url" },
  thumbnail_cache_max_mb: { label: "Cache limit", kind: "integer", unit: "MB" },
  job_history_days: { label: "Keep jobs", kind: "integer", unit: "days" },
  notification_history_days: { label: "Keep notifications", kind: "integer", unit: "days" },
};

const SETTING_KEYS = Object.keys(SETTING_FIELDS) as AppSettingKey[];

type SettingState = AppSettingsResponse[AppSettingKey];

/** What the input shows before any edit. A secret is never sent back, so it starts empty. */
export function savedText(state: SettingState): string {
  return "value" in state ? String(state.value) : "";
}

export interface SettingsDraft {
  values: Record<AppSettingKey, string>;
  resets: ReadonlySet<AppSettingKey>;
}

export function draftFromSettings(settings: AppSettingsResponse): SettingsDraft {
  const values = {} as Record<AppSettingKey, string>;
  for (const key of SETTING_KEYS) values[key] = savedText(settings[key]);
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
  const state = settings[key];
  return {
    values: { ...draft.values, [key]: "fallback" in state ? String(state.fallback) : "" },
    resets: new Set(draft.resets).add(key),
  };
}

export function isSettingEdited(
  settings: AppSettingsResponse,
  draft: SettingsDraft,
  key: AppSettingKey,
): boolean {
  return draft.resets.has(key) || draft.values[key] !== savedText(settings[key]);
}

export function editedSettingKeys(
  settings: AppSettingsResponse,
  draft: SettingsDraft,
): AppSettingKey[] {
  return SETTING_KEYS.filter((key) => isSettingEdited(settings, draft, key));
}

type ParsedValue = { value: string | number } | { error: string };

function parseValue(field: SettingField, state: SettingState, raw: string): ParsedValue {
  const text = raw.trim();
  if (!("minimum" in state)) return text ? { value: text } : { error: "a value" };

  const { minimum, maximum } = state;
  const number = text ? Number(text) : Number.NaN;
  const whole = field.kind === "integer";
  const inRange = number >= minimum && (maximum === null || number <= maximum);
  if ((whole ? Number.isInteger(number) : Number.isFinite(number)) && inRange) {
    return { value: number };
  }
  const noun = whole ? "a whole number" : "a number";
  const range = maximum === null ? `of at least ${minimum}` : `from ${minimum} to ${maximum}`;
  return { error: `${noun} ${range}` };
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
    const parsed = parseValue(field, settings[key], draft.values[key]);
    if ("error" in parsed) {
      return { key, error: `${field.fullLabel ?? field.label} needs ${parsed.error}.` };
    }
    update[key] = parsed.value;
  }

  if (reset.length) update.reset = reset;
  return { update: update as AppSettingsUpdate };
}
