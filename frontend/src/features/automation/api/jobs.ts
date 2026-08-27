import { postJson, requestJson } from "@/shared/api/http";
import { withJobPaths } from "@/features/jobs/api/jobPaths";
import type { JobStartBodies, JobStartBody } from "@/shared/api/jobStartBodies";
import type {
  ComfyPresetsResponse,
  Job,
  JobType,
  ReplaceCaptionsPreviewRequest,
  ReplaceCaptionsPreviewResponse,
  TrainingModel,
  TrainingTemplateCheckResponse,
  TrainingTemplateResponse,
  TrainLoraStartRequest,
} from "@/shared/types";

export type { JobStartBody };

export interface TrainLoraSettings {
  loraName: string;
  triggerWord: string;
  prompts: string[];
  model: TrainingModel;
  template: string | null;
}

function jobUrl(jobType: JobType, folderPath: string): string {
  const params = new URLSearchParams({ path: folderPath });
  return `/api/automation/${jobType.replace(/_/g, "-")}?${params}`;
}

export async function startAutomationJob<T extends JobType>(
  jobType: T,
  folderPath: string,
  body: JobStartBodies[T] = {},
  paths?: string[],
): Promise<Job> {
  return postJson<Job>(jobUrl(jobType, folderPath), withJobPaths(body, paths));
}

export async function previewCaptionReplacements(
  folderPath: string,
  body: ReplaceCaptionsPreviewRequest,
  signal?: AbortSignal,
): Promise<ReplaceCaptionsPreviewResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return postJson<ReplaceCaptionsPreviewResponse>(
    `/api/automation/replace-captions/preview?${params}`,
    body,
    { signal },
  );
}

export async function fetchComfyPresets(signal?: AbortSignal): Promise<ComfyPresetsResponse> {
  return requestJson<ComfyPresetsResponse>("/api/automation/comfy-process/presets", { signal });
}

export async function fetchTrainingTemplate(model: TrainingModel): Promise<string> {
  const params = new URLSearchParams({ model });
  const response = await requestJson<TrainingTemplateResponse>(
    `/api/automation/train-lora/template?${params}`,
  );
  return response.yaml;
}

export async function checkTrainingTemplate(
  template: string,
  signal?: AbortSignal,
): Promise<TrainingTemplateCheckResponse> {
  return postJson<TrainingTemplateCheckResponse>(
    "/api/automation/train-lora/template/check",
    { template },
    { signal },
  );
}

export function trainLoraBody(settings: TrainLoraSettings): TrainLoraStartRequest {
  return {
    lora_name: settings.loraName,
    trigger_word: settings.triggerWord,
    prompts: settings.prompts,
    model: settings.model,
    template: settings.template,
  };
}
