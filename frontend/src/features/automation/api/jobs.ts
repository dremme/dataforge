import { postJson, requestJson } from "@/shared/api/http";
import { withJobPaths } from "@/features/jobs/api/jobPaths";
import type { JobStartBodies, JobStartBody } from "@/shared/api/jobStartBodies";
import type {
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
  /** Edited template YAML for this run only; null uses the model's shipped template. */
  template: string | null;
}

/** Every automation route is its job type with dashes, e.g. train_lora -> train-lora. */
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

/**
 * How many captions an edit would change, before it is run.
 *
 * POST despite being read-only: the search term can be a long regular expression,
 * which is awkward to encode in a query string.
 */
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

/** The stock template for a model, as text, for the editor to open. */
export async function fetchTrainingTemplate(model: TrainingModel): Promise<string> {
  const params = new URLSearchParams({ model });
  const response = await requestJson<TrainingTemplateResponse>(
    `/api/automation/train-lora/template?${params}`,
  );
  return response.yaml;
}

/**
 * Whether an edited template would start, checked by the same parse the start path runs.
 *
 * POST despite being read-only, like `previewCaptionReplacements`: the body is a whole
 * YAML document. An unparseable draft comes back as `ok: false`, not a failed request.
 */
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
