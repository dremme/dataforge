export function groupIntoRows<T>(items: T[], columnCount: number): T[][] {
  if (columnCount <= 0 || items.length === 0) return [];

  const rowCount = Math.ceil(items.length / columnCount);
  const grouped: T[][] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const start = rowIndex * columnCount;
    grouped.push(items.slice(start, start + columnCount));
  }

  return grouped;
}

export function rowCacheKey<T extends { path: string }>(row: T[]): string {
  return row.map((item) => item.path).join("\0");
}
