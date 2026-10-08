import { createContext, useContext } from "react";

/** Marks a toolbar action's text, which a crowded toolbar hides to leave the icon. */
export const COLLAPSIBLE_LABEL_CLASS = "toolbar__collapsible-label";

/** Marks a button whose label is all it has beside one icon; compact, it becomes a circle. */
export const ROUND_WHEN_COMPACT_CLASS = "toolbar__round-when-compact";

export const ToolbarCompactContext = createContext(false);

export function useToolbarCompact(): boolean {
  return useContext(ToolbarCompactContext);
}

export interface ToolbarRowWidths {
  /** Width the row's items may use. */
  row: number;
  /** The stats group, or 0 when it has a row of its own. */
  stats: number;
  /** The folder actions as rendered now. */
  actions: number;
  /** What the hidden labels and their gaps add back; unused while they show. */
  labels: number;
  /** The view controls' content, not the space they stretch to fill. */
  controls: number;
  gap: number;
}

/**
 * Judged on the full labels whatever the current mode, so hiding them cannot make the row fit
 * and then show them again.
 */
export function toolbarNeedsCompact(widths: ToolbarRowWidths, compact: boolean): boolean {
  const actions = compact ? widths.actions + widths.labels : widths.actions;
  const items = [widths.stats, actions, widths.controls].filter((width) => width > 0);
  const needed = items.reduce((sum, width) => sum + width, 0) + widths.gap * (items.length - 1);
  return needed > widths.row + 0.5;
}
