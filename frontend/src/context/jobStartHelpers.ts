import type { Job, JobType } from "../types";
import { foldersMatch } from "../utils/folderPath";
import { jobTypeOf } from "../utils/jobs";

export type StartingJob = {
  folder: string;
  jobType: JobType;
};

export function upsertStartedJob(
  jobs: Job[],
  job: Job,
  folderPath: string,
  jobType: JobType,
): Job[] {
  return [
    job,
    ...jobs.filter(
      (entry) => !(foldersMatch(entry.folder, folderPath) && jobTypeOf(entry) === jobType),
    ),
  ];
}

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
