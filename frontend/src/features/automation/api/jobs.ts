import { postJson } from "@/shared/api/http";
import { withJobPaths } from "@/features/jobs/api/jobPaths";
import type { BodyPartsSettings } from "@/features/automation/preferences/bodyPartsPreferences";
import type { Job, JobType } from "@/shared/types";

export interface TrainLoraSettings {
  loraName: string;
  triggerWord: string;
  prompts: string[];
}

/** The request body of a job start, minus the selected paths the caller adds. */
export type JobStartBody = Record<string, unknown>;

/** Every automation route is its job type with dashes, e.g. train_lora -> train-lora. */
function jobUrl(jobType: JobType, folderPath: string): string {
  const params = new URLSearchParams({ path: folderPath });
  return `/api/automation/${jobType.replace(/_/g, "-")}?${params}`;
}

export async function startAutomationJob(
  jobType: JobType,
  folderPath: string,
  body: JobStartBody = {},
  paths?: string[],
): Promise<Job> {
  return postJson<Job>(jobUrl(jobType, folderPath), withJobPaths(body, paths));
}

export function bodyPartsBody(settings: BodyPartsSettings): JobStartBody {
  return {
    body_description: settings.bodyDescription,
    face_description: settings.faceDescription,
    keywords: settings.keywords,
    element_description: settings.elementDescription,
  };
}

export function trainLoraBody(settings: TrainLoraSettings): JobStartBody {
  return {
    lora_name: settings.loraName,
    trigger_word: settings.triggerWord,
    prompts: settings.prompts,
  };
}
