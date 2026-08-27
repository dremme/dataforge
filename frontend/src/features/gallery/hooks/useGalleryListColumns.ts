import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { rowMarkers, rowMetaCells, type RowMetaColumn } from "@/features/gallery/lib/listRowCells";
import type { GalleryItem } from "@/shared/types";

type TextColumn = RowMetaColumn;

const TEXT_COLUMNS = [
  "megapixels",
  "duration",
  "size",
  "modified",
] as const satisfies readonly TextColumn[];

const WIDTH_COLUMNS = ["markers", "status", ...TEXT_COLUMNS] as const;

/** Longest few values per column: the widest string is not reliably the longest one. */
const MEASURED_CANDIDATES = 6;

/** Guards against a fractional measurement rounding a column into an ellipsis. */
const COLUMN_SLACK_PX = 2.5;

interface ListColumnContent {
  values: Record<TextColumn, string[]>;
  markerCount: number;
}

type ColumnWidths = Record<(typeof WIDTH_COLUMNS)[number], number>;

function emptyTextColumns<T>(value: () => T): Record<TextColumn, T> {
  return Object.fromEntries(TEXT_COLUMNS.map((column) => [column, value()])) as Record<
    TextColumn,
    T
  >;
}

function longestFirst(values: Set<string>): string[] {
  return [...values].sort((a, b) => b.length - a.length).slice(0, MEASURED_CANDIDATES);
}

/** Values from every item, not the rendered rows: DOM-sized columns resize as it scrolls. */
function collectColumnContent(items: GalleryItem[]): ListColumnContent {
  const distinct = emptyTextColumns(() => new Set<string>());
  let markerCount = 0;

  for (const item of items) {
    for (const cell of rowMetaCells(item)) {
      distinct[cell.key].add(cell.value);
    }
    markerCount = Math.max(markerCount, rowMarkers(item).length);
  }

  return {
    values: Object.fromEntries(
      TEXT_COLUMNS.map((column) => [column, longestFirst(distinct[column])]),
    ) as Record<TextColumn, string[]>,
    markerCount,
  };
}

function cellClassName(column: TextColumn): string {
  return `gallery-list-row__meta-item gallery-list-row__meta-item--${column}`;
}

function probeElement(className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  return span;
}

function probeTextCell(className: string, text: string): HTMLSpanElement {
  const span = probeElement(className);
  // Real cells truncate; a probe takes the width its content wants. Icons keep their class.
  span.style.cssText = "display:inline-flex;width:auto;max-width:none;overflow:visible;";
  span.textContent = text;
  return span;
}

/** Measure in the DOM: canvas metrics ignore font features and come back narrow. */
function measureColumns(host: HTMLElement, content: ListColumnContent): ColumnWidths {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;white-space:pre;";

  const cells: { column: keyof ColumnWidths; element: HTMLSpanElement }[] = [];
  for (const column of TEXT_COLUMNS) {
    for (const value of content.values[column]) {
      const element = probeTextCell(cellClassName(column), value);
      probe.appendChild(element);
      cells.push({ column, element });
    }
  }

  if (content.markerCount > 0) {
    const markers = probeElement("gallery-list-row__markers");
    markers.style.cssText = "width:auto;overflow:visible;";
    for (let index = 0; index < content.markerCount; index += 1) {
      const marker = probeElement("gallery-list-row__marker");
      marker.appendChild(probeElement("gallery-list-row__marker-icon"));
      markers.appendChild(marker);
    }
    probe.appendChild(markers);
    cells.push({ column: "markers", element: markers });
  }

  const status = probeElement("gallery-list-row__status");
  status.style.cssText = "width:auto;";
  status.appendChild(probeElement("gallery-list-row__status-icon"));
  probe.appendChild(status);
  cells.push({ column: "status", element: status });

  host.appendChild(probe);
  const widths = Object.fromEntries(WIDTH_COLUMNS.map((column) => [column, 0])) as ColumnWidths;
  for (const { column, element } of cells) {
    widths[column] = Math.max(widths[column], element.getBoundingClientRect().width);
  }
  probe.remove();

  return widths;
}

function toStyle(widths: ColumnWidths): CSSProperties {
  const track = (value: number) =>
    value === 0 ? "0px" : `${Math.ceil(value) + COLUMN_SLACK_PX}px`;

  return Object.fromEntries(
    WIDTH_COLUMNS.map((column) => [`--gallery-list-col-${column}`, track(widths[column])]),
  ) as CSSProperties;
}

export function useGalleryListColumns(
  hostRef: RefObject<HTMLElement | null>,
  items: GalleryItem[],
  enabled: boolean,
): CSSProperties | undefined {
  const content = useMemo(() => (enabled ? collectColumnContent(items) : null), [enabled, items]);
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!content || !host) {
      setStyle(undefined);
      return;
    }

    setStyle(toStyle(measureColumns(host, content)));
  }, [content, hostRef]);

  return style;
}
