import { folderKey } from "@/features/folder/lib/folderPath";
import type { JobsQuery } from "@/features/jobs/lib/jobFilters";

export const jobKeys = {
  live: ["jobs", "live"] as const,
  external: ["jobs", "external"] as const,
  history: ["jobs", "history"] as const,
  historyPage: (query: JobsQuery) => ["jobs", "history", query] as const,
  folderLatest: (folderPath: string) => ["jobs", "folder-latest", folderKey(folderPath)] as const,
  results: (jobId: string, finishedAt: string | null | undefined) =>
    ["jobs", "results", jobId, finishedAt ?? null] as const,
  samples: (trainingName: string) => ["jobs", "samples", trainingName] as const,
  finishedSamples: (jobId: string, step: number) =>
    ["jobs", "finished-samples", jobId, step] as const,
};
