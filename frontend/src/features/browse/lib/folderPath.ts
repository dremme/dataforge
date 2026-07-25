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

function normalizeForMatch(path: string): string {
  // Canonical form for comparisons: normalized display form, / separators, lowercased.
  // Handles drive roots etc via normalizeFolderPath.
  const norm = normalizeFolderPath(path).replace(/\\/g, "/");
  return norm.toLowerCase();
}

export function foldersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeForMatch(a) === normalizeForMatch(b);
}

export function folderPathsEqual(left: string, right: string): boolean {
  return foldersMatch(left, right);
}
