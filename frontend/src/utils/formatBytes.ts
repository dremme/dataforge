export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 10) {
    return `${Math.round(gib)} GB`;
  }
  return `${gib.toFixed(1)} GB`;
}
