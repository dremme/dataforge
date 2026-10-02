export function folderLeafName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || path;
}

export function normalizeFolderPath(path: string): string {
  const trimmed = path.trim().replace(/\//g, "\\");
  const driveRootMatch = trimmed.match(/^([A-Za-z]:)(?:\\)?$/i);

  if (driveRootMatch) {
    return `${driveRootMatch[1].toUpperCase()}\\`;
  }

  return trimmed.replace(/\\+$/, "");
}

/** One spelling per folder, for comparisons and cache keys: `/` separators, lowercased. */
export function folderKey(path: string): string {
  return normalizeFolderPath(path).replace(/\\/g, "/").toLowerCase();
}

export function foldersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return folderKey(a) === folderKey(b);
}

export function folderPathsEqual(left: string, right: string): boolean {
  return foldersMatch(left, right);
}
