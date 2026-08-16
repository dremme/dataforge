import { postJson } from "@/shared/api/http";
import { withJobPaths } from "@/features/jobs/api/jobPaths";
import type { JobStartBodies, JobStartBody } from "@/shared/api/jobStartBodies";
import type {
  Job,
  JobType,
  ReplaceCaptionsPreviewRequest,
  ReplaceCaptionsPreviewResponse,
  TrainLoraStartRequest,
} from "@/shared/types";

export type { JobStartBody };

export interface TrainLoraSettings {
  loraName: string;
  triggerWord: string;
  prompts: string[];
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

export function trainLoraBody(settings: TrainLoraSettings): TrainLoraStartRequest {
  return {
    lora_name: settings.loraName,
    trigger_word: settings.triggerWord,
    prompts: settings.prompts,
  };
}
