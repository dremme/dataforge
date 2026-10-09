import type { JobType } from "@/shared/types";
import { foldersMatch } from "@/features/folder/lib/folderPath";

export type StartingJob = {
  folder: string;
  jobType: JobType;
};

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
