import {
  QUICK_ACTION_SECTIONS,
  type QuickActionGroup,
  type QuickActionItem,
  type QuickActionSection,
} from "../types";
import { MAX_RECENT_ACTIONS } from "./quickActionHistory";

/**
 * Rows the palette will ever show at once — across all sections, not per section.
 * A per-section cap let six sections stack into a list that had to scroll; one
 * global cap is what keeps the panel a fixed, scrollbar-free height.
 */
export const MAX_RESULT_ROWS = 8;

/**
 * Match tiers, best first. Deliberately substring rather than fuzzy subsequence:
 * every other search in the app (`filterBySearch`) is substring, and a subsequence
 * matcher turns short queries into noise.
 *
 * The exact tier earns its place: typing a job's whole name should reach the job,
 * and a prefix tier alone cannot do that — "watermark" is a prefix of both the
 * Watermark job and a folder called "watermarked", so they would tie and the
 * folder would win on declared section order.
 */
const RANK_LABEL_EXACT = 0;
const RANK_LABEL_PREFIX = 1;
const RANK_LABEL_WORD = 2;
const RANK_LABEL_SUBSTRING = 3;
const RANK_SECONDARY = 4;

const WORD_SEPARATORS = /[\s\-_\\/.]+/;

function rankOf(item: QuickActionItem, needle: string): number | null {
  const label = item.label.toLowerCase();

  if (label === needle) return RANK_LABEL_EXACT;
  if (label.startsWith(needle)) return RANK_LABEL_PREFIX;
  if (label.split(WORD_SEPARATORS).some((word) => word.startsWith(needle))) return RANK_LABEL_WORD;
  if (label.includes(needle)) return RANK_LABEL_SUBSTRING;

  const secondary = `${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  if (secondary.includes(needle)) return RANK_SECONDARY;

  return null;
}

/**
 * Filter, then group by section.
 *
 * Sections are ordered by their best contained match, falling back to the declared
 * order when two tie. Grouping alone is not enough: typing "watermark" turns up the
 * Watermark job (an exact label prefix) and a folder called "watermarked" (a weaker
 * word match), and a fixed section order would bury the better hit under the worse
 * one purely because folders are declared first.
 *
 * Returns an empty array for a blank query; the caller shows the recent list instead.
 */
export function rankQuickActionItems(items: QuickActionItem[], query: string): QuickActionGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const declaredIndex = new Map(QUICK_ACTION_SECTIONS.map((section, index) => [section.id, index]));
  const sectionRank = (section: QuickActionSection) => declaredIndex.get(section) ?? 0;

  // Ranked as one flat list before grouping. Ranking inside each section instead
  // would let a weak match in an early section crowd out a strong one later,
  // because the cap is global.
  const best = items
    .map((item, buildIndex) => ({ item, rank: rankOf(item, needle), buildIndex }))
    .filter(
      (entry): entry is { item: QuickActionItem; rank: number; buildIndex: number } =>
        entry.rank !== null,
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        sectionRank(a.item.section) - sectionRank(b.item.section) ||
        a.buildIndex - b.buildIndex,
    )
    .slice(0, MAX_RESULT_ROWS);

  // Sections appear in the order their best row does, so the heading carrying the
  // strongest match leads without needing a second sort.
  const groups: QuickActionGroup[] = [];
  const bySection = new Map<QuickActionSection, QuickActionGroup>();

  for (const { item } of best) {
    let group = bySection.get(item.section);

    if (!group) {
      const section = QUICK_ACTION_SECTIONS[sectionRank(item.section)];
      group = { id: section.id, label: section.label, items: [] };
      bySection.set(item.section, group);
      groups.push(group);
    }

    group.items.push(item);
  }

  return groups;
}

/**
 * The empty-query list: the last actions the user actually ran, rebuilt against
 * current state.
 *
 * An id that no longer resolves — a deleted job, a job type the folder cannot run
 * — is skipped rather than rendered dead. `synthesize` covers the case that matters
 * most: a folder that has since dropped out of recents and favorites is still
 * perfectly navigable, because its path is inside the id.
 */
export function resolveRecentActions(
  recentIds: string[],
  items: QuickActionItem[],
  synthesize: (id: string) => QuickActionItem | null,
  topUp: QuickActionItem[],
): QuickActionItem[] {
  const byId = new Map(items.map((item) => [item.id.toLowerCase(), item]));
  const resolved: QuickActionItem[] = [];
  const taken = new Set<string>();

  const push = (item: QuickActionItem | null | undefined): void => {
    if (!item) return;

    const key = item.id.toLowerCase();
    if (taken.has(key)) return;

    taken.add(key);
    resolved.push(item);
  };

  for (const id of recentIds) {
    if (resolved.length >= MAX_RECENT_ACTIONS) break;
    push(byId.get(id.toLowerCase()) ?? synthesize(id));
  }

  // A short or first-run history would otherwise open on an empty panel.
  for (const item of topUp) {
    if (resolved.length >= MAX_RECENT_ACTIONS) break;
    push(item);
  }

  return resolved;
}

export function recentActionsGroup(items: QuickActionItem[]): QuickActionGroup[] {
  return items.length > 0 ? [{ id: "recent", label: "Recent", items }] : [];
}

/** Flatten groups back into the selectable order the arrow keys walk. */
export function flattenGroups(groups: QuickActionGroup[]): QuickActionItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * Strip repeat ids across groups, keeping the first, and drop any group that
 * empties out.
 *
 * The palette resolves its active row by id, so two rows sharing one would pin
 * the highlight to the first copy and make the arrow keys look stuck. Enforced
 * here, at the boundary the rendering and the selection both read, rather than
 * trusted of whoever assembled the groups.
 */
export function withUniqueIds(groups: QuickActionGroup[]): QuickActionGroup[] {
  const taken = new Set<string>();

  return groups.flatMap((group) => {
    const items = group.items.filter((item) => {
      const key = item.id.toLowerCase();
      if (taken.has(key)) return false;

      taken.add(key);
      return true;
    });

    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

/**
 * Flatten the per-section builders into one list, in `QUICK_ACTION_SECTIONS`
 * order, keeping the first item to claim each id.
 *
 * The dedupe is load-bearing, not tidiness. A folder can legitimately be both a
 * subfolder of the folder you are in and a recent folder, and both builders mint
 * the same `folder:<path>` id — so it would render twice, and the palette tracks
 * the active row *by id*: `findIndex` would resolve the second copy back to the
 * first, pinning the highlight and making arrow keys look stuck.
 *
 * Ordering here from the same constant that drives display keeps the two from
 * drifting: reordering a section reorders which copy of a shared id survives.
 */
export function orderQuickActionItems(
  bySection: Record<QuickActionSection, QuickActionItem[]>,
): QuickActionItem[] {
  const ordered: QuickActionItem[] = [];
  const taken = new Set<string>();

  for (const section of QUICK_ACTION_SECTIONS) {
    for (const item of bySection[section.id]) {
      const key = item.id.toLowerCase();
      if (taken.has(key)) continue;

      taken.add(key);
      ordered.push(item);
    }
  }

  return ordered;
}
