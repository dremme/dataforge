import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import {
  COLLAPSIBLE_LABEL_CLASS,
  ROUND_WHEN_COMPACT_CLASS,
  toolbarNeedsCompact,
  type ToolbarRowWidths,
} from "@/features/gallery/lib/toolbarCompact";

function px(value: string): number {
  return parseFloat(value) || 0;
}

/**
 * What a button that turns round gives back beyond its label: its pill padding, less the
 * circle's width. Only visible while the labels show, so it is kept from the last such
 * measurement; every collapsible button shares the same pill.
 */
interface RoundSaving {
  px: number;
}

function labelSavings(actions: HTMLElement, compact: boolean, round: RoundSaving): number {
  let total = 0;
  for (const label of actions.querySelectorAll<HTMLElement>(`.${COLLAPSIBLE_LABEL_CLASS}`)) {
    const button = label.parentElement;
    if (!button) continue;
    // A hidden label keeps its text width as scrollWidth; dropping it also drops one flex gap.
    const gap = px(getComputedStyle(button).columnGap);
    total += label.scrollWidth + gap;
    if (!button.classList.contains(ROUND_WHEN_COMPACT_CLASS)) continue;
    if (!compact) {
      const { width, height } = button.getBoundingClientRect();
      round.px = Math.max(0, width - label.scrollWidth - gap - height);
    }
    total += round.px;
  }
  return total;
}

function measureToolbarRow(toolbar: HTMLElement, round: RoundSaving): ToolbarRowWidths | null {
  const actions = toolbar.querySelector<HTMLElement>(".toolbar__actions");
  const controls = toolbar.querySelector<HTMLElement>(".toolbar__controls");
  if (!actions || !controls) return null;

  // Below the stats breakpoint the stats take a row of their own; the rest shares the next.
  const stats = toolbar.querySelector<HTMLElement>(".toolbar__stats");
  const statsWidth =
    stats && getComputedStyle(stats).flexBasis !== "100%" ? stats.getBoundingClientRect().width : 0;
  const children = Array.from(controls.children);
  const first = children.at(0)?.getBoundingClientRect();
  const last = children.at(-1)?.getBoundingClientRect();
  const compact = toolbar.classList.contains("toolbar--compact");
  const style = getComputedStyle(toolbar);

  return {
    row: toolbar.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    stats: statsWidth,
    actions: actions.getBoundingClientRect().width,
    labels: labelSavings(actions, compact, round),
    controls: first && last ? last.right - first.left : 0,
    gap: px(style.columnGap),
  };
}

/** Whether the folder actions should drop their labels so the toolbar keeps to one row. */
export function useToolbarCompactMode(toolbarRef: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(compact);
  compactRef.current = compact;

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const round: RoundSaving = { px: 0 };
    const decide = () => {
      const widths = measureToolbarRow(toolbar, round);
      return widths ? toolbarNeedsCompact(widths, compactRef.current) : compactRef.current;
    };
    // Observers run after layout but before paint. A plain state update renders in a later
    // task, so the wrapped row would be painted for a frame; committing now skips that frame.
    const measure = () => {
      const next = decide();
      if (next !== compactRef.current) flushSync(() => setCompact(next));
    };
    // The search field grows as it is typed into, and job state swaps action buttons.
    const resizes = new ResizeObserver(measure);
    const observe = () => {
      resizes.observe(toolbar);
      toolbar
        .querySelectorAll(".toolbar__stats, .toolbar__actions, .toolbar__controls > *")
        .forEach((element) => resizes.observe(element));
    };
    const mutations = new MutationObserver(() => {
      observe();
      measure();
    });

    observe();
    // Inside the layout effect a plain update already lands before paint.
    setCompact(decide());
    mutations.observe(toolbar, { childList: true, subtree: true });
    return () => {
      resizes.disconnect();
      mutations.disconnect();
    };
  }, [toolbarRef]);

  return compact;
}
