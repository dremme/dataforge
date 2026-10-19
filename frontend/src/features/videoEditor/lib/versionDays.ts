import { formatDayLabel } from "@/shared/lib/format";
import type { VideoProjectVersionSummary } from "@/shared/types";

export interface VersionDay {
  label: string;
  versions: VideoProjectVersionSummary[];
}

/** Runs of versions saved on the same local day, keeping the given (newest-first) order. */
export function groupVersionsByDay(
  versions: readonly VideoProjectVersionSummary[],
  nowMs = Date.now(),
): VersionDay[] {
  const days: VersionDay[] = [];
  for (const version of versions) {
    const label = formatDayLabel(version.created_at, nowMs) ?? "Earlier";
    const last = days.at(-1);
    if (last?.label === label) last.versions.push(version);
    else days.push({ label, versions: [version] });
  }
  return days;
}
