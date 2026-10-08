import type { Subfolder } from "@/shared/types";

function hasCounts(subfolder: Subfolder): boolean {
  return subfolder.file_count != null;
}

/**
 * `fresh` with the counts it left out taken from `previous`, so a recount shows the old numbers
 * instead of flashing placeholders. `carried` says whether a recount is owed.
 */
export function carrySubfolderCounts(
  previous: Subfolder[],
  fresh: Subfolder[],
): { subfolders: Subfolder[]; carried: boolean } {
  const held = new Map(previous.filter(hasCounts).map((entry) => [entry.path, entry]));
  let carried = false;

  const subfolders = fresh.map((subfolder) => {
    const old = held.get(subfolder.path);
    if (hasCounts(subfolder) || !old) return subfolder;

    carried = true;
    return {
      ...subfolder,
      file_count: old.file_count,
      captioned_count: old.captioned_count,
      issue_count: old.issue_count,
      duplicate_count: old.duplicate_count,
    };
  });

  return carried ? { subfolders, carried } : { subfolders: fresh, carried };
}
