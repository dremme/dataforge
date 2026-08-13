import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import {
  rowMarkers,
  rowMetaCells,
  rowStatusText,
  type RowMetaColumn,
} from "@/features/gallery/lib/listRowCells";
import type { GalleryItem } from "@/shared/types";

type TextColumn = RowMetaColumn | "status";

const TEXT_COLUMNS: TextColumn[] = ["status", "megapixels", "size", "modified"];

/**
 * How many of a column's distinct values get measured.
 *
 * The widest string is not reliably the longest one - a date's month name and a
 * file size's unit are different widths at equal length - so the longest few are
 * measured instead of only the longest, which costs a handful of reads rather
 * than one per file.
 */
const MEASURED_CANDIDATES = 6;

/** Guards against a fractional measurement rounding a column into an ellipsis. */
const COLUMN_SLACK_PX = 2;

interface ListColumnContent {
  values: Record<TextColumn, string[]>;
  markerCount: number;
}

type ColumnWidths = Record<TextColumn | "markers", number>;

function longestFirst(values: Set<string>): string[] {
  return [...values].sort((a, b) => b.length - a.length).slice(0, MEASURED_CANDIDATES);
}

/**
 * The values a folder will actually show, per column.
 *
 * Taken from every item rather than the rendered ones: only a screenful of rows
 * is ever in the DOM, and columns sized from those would resize under the cursor
 * as the list scrolls.
 */
function collectColumnContent(items: GalleryItem[]): ListColumnContent {
  const distinct: Record<TextColumn, Set<string>> = {
    status: new Set(),
    megapixels: new Set(),
    size: new Set(),
    modified: new Set(),
  };
  let markerCount = 0;

  for (const item of items) {
    distinct.status.add(rowStatusText(item));
    for (const cell of rowMetaCells(item)) {
      distinct[cell.key].add(cell.value);
    }
    markerCount = Math.max(markerCount, rowMarkers(item).length);
  }

  return {
    values: {
      status: longestFirst(distinct.status),
      megapixels: longestFirst(distinct.megapixels),
      size: longestFirst(distinct.size),
      modified: longestFirst(distinct.modified),
    },
    markerCount,
  };
}

function cellClassName(column: TextColumn): string {
  return column === "status"
    ? "gallery-list-row__status"
    : `gallery-list-row__meta-item gallery-list-row__meta-item--${column}`;
}

function probeElement(className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  return span;
}

function probeTextCell(className: string, text: string): HTMLSpanElement {
  const span = probeElement(className);
  // The real cells truncate and are stretched by their track; a probe has to be
  // free to take exactly the width its content wants. Only text cells get this:
  // an icon's width comes from its own class, which an inline style would beat.
  span.style.cssText = "display:inline-flex;width:auto;max-width:none;overflow:visible;";
  span.textContent = text;
  return span;
}

/**
 * Widest rendered width per column, in a single measuring pass.
 *
 * Measured in the DOM rather than through a canvas so the probe inherits the
 * real font, weight, and tabular figures - canvas text metrics ignore font
 * features and come back a few pixels narrow, which is the error that would
 * truncate a column.
 */
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
    // Built from the real classes so the icon size and the gap between icons come
    // from the stylesheet rather than from numbers repeated here.
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

  host.appendChild(probe);
  const widths: ColumnWidths = {
    markers: 0,
    status: 0,
    megapixels: 0,
    size: 0,
    modified: 0,
  };
  for (const { column, element } of cells) {
    widths[column] = Math.max(widths[column], element.getBoundingClientRect().width);
  }
  probe.remove();

  return widths;
}

function toStyle(widths: ColumnWidths): CSSProperties {
  const track = (value: number) =>
    value === 0 ? "0px" : `${Math.ceil(value) + COLUMN_SLACK_PX}px`;

  return {
    "--gallery-list-col-markers": track(widths.markers),
    "--gallery-list-col-status": track(widths.status),
    "--gallery-list-col-megapixels": track(widths.megapixels),
    "--gallery-list-col-size": track(widths.size),
    "--gallery-list-col-modified": track(widths.modified),
  } as CSSProperties;
}

/**
 * Sizes the list's columns to the folder's own content, the way a table sizes
 * itself to its widest cell.
 *
 * A table can do that because one element owns every row. Here the virtualizer
 * gives each row its own grid, so the widths are measured once per folder and
 * handed to every row as custom properties. A folder of small clips ends up with
 * a narrower size column than a folder of raw photos, and in both the name gets
 * whatever is left.
 */
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
