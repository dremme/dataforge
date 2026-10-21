import type { QueryClient } from "@tanstack/react-query";
import { folderKey } from "@/features/folder/lib/folderPath";
import { requestJson } from "@/shared/api/http";
import { normalizeFolderPath } from "@/features/folder/lib/folderPath";
import { DEFAULT_TRAINING_MODEL } from "@/features/automation/lib/training";
import type {
  AutomationSettingsResponse,
  ReasoningEffort,
  WatermarkOpacity,
  WatermarkPosition,
  WatermarkSizeName,
} from "@/shared/types";

export type AutomationSettings = AutomationSettingsResponse;

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
  resize: AutomationSettings["resize"];
  comfy_process: AutomationSettings["comfy_process"];
};

export type JobSettingsType = keyof JobSettingsByType;

const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
const DEFAULT_PRESERVE_THINKING = true;
const DEFAULT_WATERMARK_SIZE: WatermarkSizeName = "medium";
const DEFAULT_WATERMARK_OPACITY: WatermarkOpacity = 50;
const DEFAULT_WATERMARK_POSITION: WatermarkPosition = "bottom";
const DEFAULT_RESIZE_MEGAPIXELS = 2;
const DEFAULT_RESIZE_MULTIPLE = 32;

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
      mode: "thinking",
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      preserve_thinking: DEFAULT_PRESERVE_THINKING,
      context: "",
    },
    edit_captions: {
      mode: "instruct",
      reasoning_effort: DEFAULT_REASONING_EFFORT,
      preserve_thinking: DEFAULT_PRESERVE_THINKING,
      instruction: "",
      vision: false,
    },
    batch_rename: { stem: "", start_number: 1 },
    find_duplicates: { threshold: "near" },
    train_lora: { trigger_word: "", prompts: [], model: DEFAULT_TRAINING_MODEL },
    watermark: {
      text: "",
      size: DEFAULT_WATERMARK_SIZE,
      opacity: DEFAULT_WATERMARK_OPACITY,
      position: DEFAULT_WATERMARK_POSITION,
      strip_metadata: false,
    },
    resize: { megapixels: DEFAULT_RESIZE_MEGAPIXELS, multiple: DEFAULT_RESIZE_MULTIPLE },
    comfy_process: { preset: "", overwrite_candidates: false, by_preset: {} },
  };
}

async function fetchAutomationSettings(folderPath: string): Promise<AutomationSettings> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<AutomationSettings>(`/api/preferences/automation?${params}`);
}

/**
 * Never rejects: a preferences outage must not block a job start. Read afresh on every open and
 * never kept, because other tabs change these settings; the client only lends its retries.
 */
export function loadAutomationSettings(
  folderPath: string,
  queryClient: QueryClient,
): Promise<AutomationSettings> {
  return queryClient
    .fetchQuery({
      queryKey: ["automation-settings", folderKey(folderPath)],
      queryFn: () => fetchAutomationSettings(folderPath),
      staleTime: 0,
      gcTime: 0,
    })
    .catch(() => emptyAutomationSettings(folderPath));
}
