import { requestJson } from "@/shared/api/http";
import { withJobPaths } from "@/features/jobs/api/jobPaths";
import type { BodyPartsSettings } from "@/features/automation/preferences/bodyPartsPreferences";
import type { Job } from "@/shared/types";

export async function startAutoCaptionJob(
  folderPath: string,
  mode: "thinking" | "instruct" = "thinking",
  paths?: string[],
): Promise<Job> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<Job>(`/api/automation/auto-caption?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withJobPaths({ mode }, paths)),
  });
}

export async function startBodyPartsJob(
  folderPath: string,
  settings: BodyPartsSettings,
  paths?: string[],
): Promise<Job> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<Job>(`/api/automation/body-parts?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      withJobPaths(
        {
          body_description: settings.bodyDescription,
          face_description: settings.faceDescription,
          keywords: settings.keywords,
          element_description: settings.elementDescription,
        },
        paths,
      ),
    ),
  });
}

export async function startSetCaptionsJob(
  folderPath: string,
  caption: string,
  overwrite = false,
  paths?: string[],
): Promise<Job> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<Job>(`/api/automation/set-captions?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withJobPaths({ caption, overwrite }, paths)),
  });
}

export async function startStripMetadataJob(folderPath: string, paths?: string[]): Promise<Job> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<Job>(`/api/automation/strip-metadata?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withJobPaths({}, paths)),
  });
}

export async function startBatchRenameJob(
  folderPath: string,
  stem: string,
  paths?: string[],
): Promise<Job> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<Job>(`/api/automation/batch-rename?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withJobPaths({ stem }, paths)),
  });
}

export async function startVerifyCaptionsJob(
  folderPath: string,
  mode: "thinking" | "instruct" = "instruct",
  context = "",
  paths?: string[],
): Promise<Job> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<Job>(`/api/automation/verify-captions?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withJobPaths({ mode, context }, paths)),
  });
}
