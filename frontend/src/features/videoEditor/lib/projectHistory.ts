import type { Project } from "./timeline";

export const HISTORY_LIMIT = 200;

/**
 * The editor's undo history. Steps are whole-project snapshots, so any edit, including ones
 * added later, is undoable without its own inverse. The rules live here rather than in callers:
 *
 * - A commit that leaves the project as it was records nothing, so no control can add an empty
 *   step (which would also clear redo).
 * - Previews belong to a gesture; its first preview remembers where it started, and the next
 *   commit, undo, redo or flush settles the whole gesture as one step, so none is lost.
 * - Snapshots are never changed in place; in development they are frozen to catch any edit that
 *   tries, since one would rewrite history silently.
 */
export interface ProjectHistory {
  past: readonly Project[];
  present: Project;
  future: readonly Project[];
  /** Where the gesture being previewed started; null when none is. */
  gestureBase: Project | null;
}

export function startHistory(project: Project): ProjectHistory {
  return { past: [], present: freezeInDev(project), future: [], gestureBase: null };
}

/** The project as it stands once any gesture in progress is set aside: what saves write. */
export function settledProject(history: ProjectHistory): Project {
  return history.gestureBase ?? history.present;
}

export function previewEdit(history: ProjectHistory, next: Project): ProjectHistory {
  return {
    ...history,
    present: freezeInDev(next),
    gestureBase: history.gestureBase ?? history.present,
  };
}

export function commitEdit(history: ProjectHistory, next: Project): ProjectHistory {
  const before = settledProject(history);
  if (sameValue(next, before)) return { ...history, present: before, gestureBase: null };
  return {
    past: [...history.past, before].slice(-HISTORY_LIMIT),
    present: freezeInDev(next),
    future: [],
    gestureBase: null,
  };
}

export function settleGesture(history: ProjectHistory): ProjectHistory {
  return history.gestureBase ? commitEdit(history, history.present) : history;
}

export function undoEdit(history: ProjectHistory): ProjectHistory {
  const settled = settleGesture(history);
  const previous = settled.past.at(-1);
  if (!previous) return settled;
  return {
    past: settled.past.slice(0, -1),
    present: previous,
    future: [settled.present, ...settled.future],
    gestureBase: null,
  };
}

export function redoEdit(history: ProjectHistory): ProjectHistory {
  const settled = settleGesture(history);
  const following = settled.future[0];
  if (!following) return settled;
  return {
    past: [...settled.past, settled.present],
    present: following,
    future: settled.future.slice(1),
    gestureBase: null,
  };
}

/**
 * A change that is a fact, not an edit, such as a relinked source or remembered export
 * settings: applied to every snapshot, so undo neither records nor reverts it.
 */
export function amendAll(
  history: ProjectHistory,
  update: (project: Project) => Project,
): ProjectHistory {
  const each = (project: Project) => freezeInDev(update(project));
  return {
    past: history.past.map(each),
    present: each(history.present),
    future: history.future.map(each),
    gestureBase: history.gestureBase && each(history.gestureBase),
  };
}

export function canUndo(history: ProjectHistory): boolean {
  return history.past.length > 0 || history.gestureBase !== null;
}

export function canRedo(history: ProjectHistory): boolean {
  return history.future.length > 0;
}

/** Structural equality of JSON-shaped values; shared subtrees return early by identity. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function freezeInDev<T>(value: T): T {
  if (import.meta.env.DEV) freezeDeep(value);
  return value;
}

/** Stops at frozen objects: they were frozen whole, and snapshots share most of their tree. */
function freezeDeep(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
}
