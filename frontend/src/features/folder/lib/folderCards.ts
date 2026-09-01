import type { Subfolder } from "@/shared/types";

export const FOLDER_CLAMP_LIMIT = 10;

// Hiding a shorter tail than this buys less room than the button below the grid costs, and it
// keeps every "Show N more folders" label plural.
export const FOLDER_CLAMP_MIN_HIDDEN = 5;

export function folderFindings({
  issue_count: issues,
  duplicate_count: duplicates,
}: Subfolder): string[] {
  const findings: string[] = [];
  if (issues) findings.push(issues === 1 ? "1 caption issue" : `${issues} caption issues`);
  if (duplicates) findings.push(duplicates === 1 ? "1 duplicate" : `${duplicates} duplicates`);
  return findings;
}

export function folderCardLabel(folder: Subfolder): string {
  const findings = folderFindings(folder);
  return findings.length > 0 ? `${folder.name} (${findings.join(", ")})` : folder.name;
}

export function hasFolderFindings(folder: Subfolder): boolean {
  return folderFindings(folder).length > 0;
}

export interface FolderClamp {
  visible: Subfolder[];
  hidden: number;
  hiddenFlagged: number;
}

/**
 * The leading slice of a long folder list. Counting cards rather than rows keeps `hidden` exact:
 * the grid auto-fills its columns, so a height clamp could not report what it cut off.
 */
export function clampFolders(folders: readonly Subfolder[]): FolderClamp {
  if (folders.length < FOLDER_CLAMP_LIMIT + FOLDER_CLAMP_MIN_HIDDEN) {
    return { visible: [...folders], hidden: 0, hiddenFlagged: 0 };
  }

  const hiddenFolders = folders.slice(FOLDER_CLAMP_LIMIT);
  return {
    visible: folders.slice(0, FOLDER_CLAMP_LIMIT),
    hidden: hiddenFolders.length,
    hiddenFlagged: hiddenFolders.filter(hasFolderFindings).length,
  };
}
