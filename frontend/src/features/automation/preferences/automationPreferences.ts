import { requestJson } from "@/shared/api/http";
import { withRetry } from "@/shared/lib/retry";
import { normalizeFolderPath } from "@/features/folder/lib/folderPath";
import { DEFAULT_TRAINING_MODEL } from "@/features/automation/lib/training";
import type {
  AutomationMode,
  AutomationSettingsResponse,
  CaptionReplaceMode,
  DuplicateThreshold,
  ReasoningEffort,
  TrainingModel,
  WatermarkOpacity,
  WatermarkPosition,
  WatermarkSizeName,
} from "@/shared/types";

/** Every job's remembered settings for one folder, exactly as the backend stores them. */
export type AutomationSettings = AutomationSettingsResponse;

/**
 * The settings block each job type gets, derived from the response so a backend
 * rename fails here rather than drifting. Mirrors the `JobStartBodies` trick in
 * `@/shared/api/jobStartBodies`.
 */
export type JobSettingsByType = {
  auto_caption: AutomationSettings["auto_caption"];
  set_captions: AutomationSettings["set_captions"];
  replace_captions: AutomationSettings["replace_captions"];
  backup_captions: AutomationSettings["backup_captions"];
  verify_captions: AutomationSettings["verify_captions"];
  edit_captions: AutomationSettings["edit_captions"];
  batch_rename: AutomationSettings["batch_rename"];
  find_duplicates: AutomationSettings["find_duplicates"];
  train_lora: AutomationSettings["train_lora"];
  watermark: AutomationSettings["watermark"];
  comfy_process: AutomationSettings["comfy_process"];
};

export type JobSettingsType = keyof JobSettingsByType;

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
export const DEFAULT_PRESERVE_THINKING = true;
export const DEFAULT_WATERMARK_SIZE: WatermarkSizeName = "medium";
export const DEFAULT_WATERMARK_OPACITY: WatermarkOpacity = 50;
export const DEFAULT_WATERMARK_POSITION: WatermarkPosition = "bottom";

const AUTOMATION_MODES: readonly AutomationMode[] = ["thinking", "instruct"];
const REASONING_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "xhigh"];
const REPLACE_MODES: readonly CaptionReplaceMode[] = ["replace", "prepend", "append"];
const DUPLICATE_THRESHOLDS: readonly DuplicateThreshold[] = ["exact", "near", "loose"];
const TRAINING_MODELS: readonly TrainingModel[] = ["krea2_turbo", "h3_fl2va"];
const WATERMARK_SIZES: readonly WatermarkSizeName[] = ["small", "medium", "large"];
const WATERMARK_OPACITIES: readonly WatermarkOpacity[] = [25, 50, 75];
const WATERMARK_POSITIONS: readonly WatermarkPosition[] = ["top", "center", "bottom"];

/**
 * Narrow a stored value to one the UI can render, or fall back to the default.
 *
 * Every field that drives a `RadioTileGroup` goes through this: a value the backend
 * no longer recognises would otherwise leave the group with nothing checked.
 */
function oneOf<T extends string | number>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function block(
  settings: Partial<AutomationSettings>,
  key: JobSettingsType,
): Record<string, unknown> {
  const value = settings[key];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function emptyAutomationSettings(folderPath: string): AutomationSettings {
  return {
    folder_path: normalizeFolderPath(folderPath),
    auto_caption: {
      mode: "thinking",
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      preserve_thinking: DEFAULT_PRESERVE_THINKING,
      caption_audio: false,
    },
    set_captions: { caption: "" },
    replace_captions: {
      mode: "replace",
      search: "",
      replacement: "",
      use_regex: false,
      case_sensitive: false,
    },
    backup_captions: {},
    verify_captions: {
      mode: "instruct",
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      preserve_thinking: DEFAULT_PRESERVE_THINKING,
      context: "",
    },
    edit_captions: {
      mode: "instruct",
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      preserve_thinking: DEFAULT_PRESERVE_THINKING,
      instruction: "",
    },
    batch_rename: { stem: "", start_number: 1 },
    find_duplicates: { threshold: "near" },
    train_lora: { trigger_word: "", prompts: [], model: DEFAULT_TRAINING_MODEL },
    watermark: {
      text: "",
      size: DEFAULT_WATERMARK_SIZE,
      opacity: DEFAULT_WATERMARK_OPACITY,
      position: DEFAULT_WATERMARK_POSITION,
    },
    comfy_process: { preset: "", seed: null, prompt_text: "", overwrite_candidates: false },
  };
}

function parseSettings(data: Partial<AutomationSettings>, folderPath: string): AutomationSettings {
  const defaults = emptyAutomationSettings(folderPath);

  const autoCaption = block(data, "auto_caption");
  const setCaptions = block(data, "set_captions");
  const replaceCaptions = block(data, "replace_captions");
  const verifyCaptions = block(data, "verify_captions");
  const editCaptions = block(data, "edit_captions");
  const batchRename = block(data, "batch_rename");
  const findDuplicates = block(data, "find_duplicates");
  const trainLora = block(data, "train_lora");
  const watermark = block(data, "watermark");
  const comfyProcess = block(data, "comfy_process");

  return {
    folder_path:
      typeof data.folder_path === "string" && data.folder_path
        ? data.folder_path
        : defaults.folder_path,
    auto_caption: {
      mode: oneOf(AUTOMATION_MODES, autoCaption.mode, defaults.auto_caption.mode),
      reasoning_effort: oneOf(
        REASONING_EFFORTS,
        autoCaption.reasoning_effort,
        DEFAULT_REASONING_EFFORT,
      ),
      preserve_thinking: flag(autoCaption.preserve_thinking, DEFAULT_PRESERVE_THINKING),
      caption_audio: flag(autoCaption.caption_audio, false),
    },
    set_captions: { caption: text(setCaptions.caption) },
    replace_captions: {
      mode: oneOf(REPLACE_MODES, replaceCaptions.mode, defaults.replace_captions.mode),
      search: text(replaceCaptions.search),
      replacement: text(replaceCaptions.replacement),
      use_regex: flag(replaceCaptions.use_regex, false),
      case_sensitive: flag(replaceCaptions.case_sensitive, false),
    },
    backup_captions: {},
    verify_captions: {
      mode: oneOf(AUTOMATION_MODES, verifyCaptions.mode, defaults.verify_captions.mode),
      reasoning_effort: oneOf(
        REASONING_EFFORTS,
        verifyCaptions.reasoning_effort,
        DEFAULT_REASONING_EFFORT,
      ),
      preserve_thinking: flag(verifyCaptions.preserve_thinking, DEFAULT_PRESERVE_THINKING),
      context: text(verifyCaptions.context),
    },
    edit_captions: {
      mode: oneOf(AUTOMATION_MODES, editCaptions.mode, defaults.edit_captions.mode),
      reasoning_effort: oneOf(
        REASONING_EFFORTS,
        editCaptions.reasoning_effort,
        DEFAULT_REASONING_EFFORT,
      ),
      preserve_thinking: flag(editCaptions.preserve_thinking, DEFAULT_PRESERVE_THINKING),
      instruction: text(editCaptions.instruction),
    },
    batch_rename: {
      stem: text(batchRename.stem),
      start_number:
        typeof batchRename.start_number === "number" && Number.isFinite(batchRename.start_number)
          ? batchRename.start_number
          : defaults.batch_rename.start_number,
    },
    find_duplicates: {
      threshold: oneOf(
        DUPLICATE_THRESHOLDS,
        findDuplicates.threshold,
        defaults.find_duplicates.threshold,
      ),
    },
    train_lora: {
      trigger_word: text(trainLora.trigger_word),
      prompts: Array.isArray(trainLora.prompts)
        ? trainLora.prompts.filter((prompt): prompt is string => typeof prompt === "string")
        : [],
      model: oneOf(TRAINING_MODELS, trainLora.model, DEFAULT_TRAINING_MODEL),
    },
    watermark: {
      text: text(watermark.text),
      size: oneOf(WATERMARK_SIZES, watermark.size, DEFAULT_WATERMARK_SIZE),
      opacity: oneOf(WATERMARK_OPACITIES, watermark.opacity, DEFAULT_WATERMARK_OPACITY),
      position: oneOf(WATERMARK_POSITIONS, watermark.position, DEFAULT_WATERMARK_POSITION),
    },
    comfy_process: {
      // Not narrowed against the preset list: presets are files the user adds and
      // removes, and the dialog fetches the current ones anyway. A stored name that no
      // longer exists is dropped there, where the real list is known.
      preset: text(comfyProcess.preset),
      seed:
        typeof comfyProcess.seed === "number" && Number.isFinite(comfyProcess.seed)
          ? comfyProcess.seed
          : null,
      prompt_text: text(comfyProcess.prompt_text),
      overwrite_candidates: flag(comfyProcess.overwrite_candidates, false),
    },
  };
}

async function fetchAutomationSettings(folderPath: string): Promise<AutomationSettings> {
  const params = new URLSearchParams({ path: folderPath });
  return parseSettings(
    await requestJson<Partial<AutomationSettings>>(`/api/preferences/automation?${params}`),
    folderPath,
  );
}

/**
 * Never rejects: a preferences outage must not stop the user from starting a job.
 *
 * There is no matching update: the job-start routes store what they ran with, so
 * settings are remembered by running a job and never by opening its dialog.
 *
 * Deliberately uncached — no localStorage mirror and no memoised answer, unlike the
 * sibling modules in `shared/preferences/uiPreferences.ts` and
 * `features/gallery/preferences/galleryDisplayPreferences.ts`. Every job start moves
 * the per-folder value *and* the "last used" fallback every other folder reads, and
 * it can happen in another folder or another tab, so a local copy could only ever be
 * a stale one. The backend is the single source of truth; the payload is a few
 * hundred bytes and the dialog already awaits it before opening. A test in
 * `automationPreferences.test.ts` pins that Web Storage is never touched.
 */
export async function loadAutomationSettings(folderPath: string): Promise<AutomationSettings> {
  try {
    return await withRetry(() => fetchAutomationSettings(folderPath));
  } catch {
    return emptyAutomationSettings(folderPath);
  }
}
