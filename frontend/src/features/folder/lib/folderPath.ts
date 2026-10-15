export function folderLeafName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || path;
}

/** One spelling per folder: a POSIX path keeps its slashes, a Windows path gets backslashes. */
export function normalizeFolderPath(path: string): string {
  const posix = path.trim();
  // A single leading slash is a POSIX root; two are a Windows network share.
  if (/^\/(?!\/)/.test(posix)) return posix.replace(/\/+$/, "") || "/";
  const trimmed = posix.replace(/\//g, "\\");
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

/** The folder holding a file; a path with no separator is its own folder. */
export function parentFolderPath(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut > 0 ? path.slice(0, cut) : path;
}
