import type { JobType } from "@/shared/types";
import { foldersMatch } from "@/features/folder/lib/folderPath";

export type StartingJob = {
  folder: string;
  jobType: JobType;
};

export function isStartingJobForFolder(
  startingJob: StartingJob | null,
  folderPath: string | undefined,
  jobType: JobType,
): boolean {
  if (!startingJob || !folderPath) return false;
  return startingJob.jobType === jobType && foldersMatch(startingJob.folder, folderPath);
}

export function clearStartingJobIfMatch(
  current: StartingJob | null,
  folderPath: string,
  jobType: JobType,
): StartingJob | null {
  if (current && foldersMatch(current.folder, folderPath) && current.jobType === jobType) {
    return null;
  }
  return current;
}
