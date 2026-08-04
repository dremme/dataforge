import { postJson } from "@/shared/api/http";
import { withJobPaths } from "@/features/jobs/api/jobPaths";
import type {
  Job,
  JobStartBodies,
  JobStartBody,
  JobType,
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

export function trainLoraBody(settings: TrainLoraSettings): TrainLoraStartRequest {
  return {
    lora_name: settings.loraName,
    trigger_word: settings.triggerWord,
    prompts: settings.prompts,
  };
}
