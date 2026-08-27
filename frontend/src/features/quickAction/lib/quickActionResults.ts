import {
  QUICK_ACTION_SECTIONS,
  type QuickActionGroup,
  type QuickActionItem,
  type QuickActionSection,
} from "../types";
import { MAX_RECENT_ACTIONS } from "./quickActionHistory";

/** Global cap so six sections cannot stack into a scrolling list. */
export const MAX_RESULT_ROWS = 8;

/**
 * Substring, not fuzzy: other search is substring and short fuzzy queries are noise.
 * Exact beats prefix so "watermark" ranks the job over a "watermarked" folder.
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

export function rankQuickActionItems(items: QuickActionItem[], query: string): QuickActionGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const declaredIndex = new Map(QUICK_ACTION_SECTIONS.map((section, index) => [section.id, index]));
  const sectionRank = (section: QuickActionSection) => declaredIndex.get(section) ?? 0;

  // Rank flat before grouping so a weak early match cannot crowd out a stronger later one.
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

  for (const item of topUp) {
    if (resolved.length >= MAX_RECENT_ACTIONS) break;
    push(item);
  }

  return resolved;
}

export function recentActionsGroup(items: QuickActionItem[]): QuickActionGroup[] {
  return items.length > 0 ? [{ id: "recent", label: "Recent", items }] : [];
}

export function flattenGroups(groups: QuickActionGroup[]): QuickActionItem[] {
  return groups.flatMap((group) => group.items);
}

/** Drop duplicate ids; the palette tracks the active row by id, so repeats pin the highlight. */
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
