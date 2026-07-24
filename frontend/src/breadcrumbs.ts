import type { Breadcrumb } from "./types";

function normalizeSeparators(path: string): string {
  return path.replace(/\//g, "\\");
}

export function buildBreadcrumbs(folderPath: string): Breadcrumb[] {
  const normalized = normalizeSeparators(folderPath.trim());
  if (!normalized) return [];

  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\\|$)/);
  if (driveMatch) {
    const drive = driveMatch[1];
    const crumbs: Breadcrumb[] = [{ name: drive, path: `${drive}\\` }];
    const remainder = normalized.slice(drive.length + 1);
    const segments = remainder.split("\\").filter(Boolean);

    let current = `${drive}\\`;
    for (const segment of segments) {
      current += segment;
      crumbs.push({ name: segment, path: current });
      current += "\\";
    }

    const last = crumbs[crumbs.length - 1];
    if (last) {
      last.path = normalized;
    }

    return crumbs;
  }

  const isAbsolute = normalized.startsWith("\\");
  const segments = normalized.split("\\").filter(Boolean);
  const crumbs: Breadcrumb[] = [];
  let current = isAbsolute ? "\\" : "";

  for (const segment of segments) {
    current = current ? `${current.replace(/\\$/, "")}\\${segment}` : segment;
    crumbs.push({ name: segment, path: current });
  }

  if (crumbs.length > 0) {
    crumbs[crumbs.length - 1].path = normalized;
  }

  return crumbs;
}
