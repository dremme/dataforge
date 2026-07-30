import { postJson } from "@/shared/api/http";
import { withJobPaths } from "@/features/jobs/api/jobPaths";
import type { BodyPartsSettings } from "@/features/automation/preferences/bodyPartsPreferences";
import type { Job } from "@/shared/types";

function jobUrl(jobPath: string, folderPath: string): string {
  const params = new URLSearchParams({ path: folderPath });
  return `/api/automation/${jobPath}?${params}`;
}

export async function startAutoCaptionJob(
  folderPath: string,
  mode: "thinking" | "instruct" = "thinking",
  paths?: string[],
): Promise<Job> {
  return postJson<Job>(jobUrl("auto-caption", folderPath), withJobPaths({ mode }, paths));
}

export async function startBodyPartsJob(
  folderPath: string,
  settings: BodyPartsSettings,
  paths?: string[],
): Promise<Job> {
  return postJson<Job>(
    jobUrl("body-parts", folderPath),
    withJobPaths(
      {
        body_description: settings.bodyDescription,
        face_description: settings.faceDescription,
        keywords: settings.keywords,
        element_description: settings.elementDescription,
      },
      paths,
    ),
  );
}

export async function startSetCaptionsJob(
  folderPath: string,
  caption: string,
  overwrite = false,
  paths?: string[],
): Promise<Job> {
  return postJson<Job>(
    jobUrl("set-captions", folderPath),
    withJobPaths({ caption, overwrite }, paths),
  );
}

export async function startStripMetadataJob(folderPath: string, paths?: string[]): Promise<Job> {
  return postJson<Job>(jobUrl("strip-metadata", folderPath), withJobPaths({}, paths));
}

export async function startBackupCaptionsJob(folderPath: string, paths?: string[]): Promise<Job> {
  return postJson<Job>(jobUrl("backup-captions", folderPath), withJobPaths({}, paths));
}

export async function startRestoreCaptionsJob(folderPath: string, paths?: string[]): Promise<Job> {
  return postJson<Job>(jobUrl("restore-captions", folderPath), withJobPaths({}, paths));
}

export async function startBatchRenameJob(
  folderPath: string,
  stem: string,
  paths?: string[],
): Promise<Job> {
  return postJson<Job>(jobUrl("batch-rename", folderPath), withJobPaths({ stem }, paths));
}

export async function startVerifyCaptionsJob(
  folderPath: string,
  mode: "thinking" | "instruct" = "instruct",
  context = "",
  paths?: string[],
): Promise<Job> {
  return postJson<Job>(
    jobUrl("verify-captions", folderPath),
    withJobPaths({ mode, context }, paths),
  );
}
