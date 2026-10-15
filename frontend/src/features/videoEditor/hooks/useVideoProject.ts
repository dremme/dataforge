import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, formatApiError } from "@/shared/api/http";
import type { VideoProjectDocument, VideoProjectSourceStatus } from "@/shared/types";
import { saveVideoProject } from "@/features/videoEditor/api/videoProjects";
import {
  amendAll,
  canRedo,
  canUndo,
  commitEdit,
  previewEdit,
  redoEdit,
  settledProject,
  settleGesture,
  startHistory,
  undoEdit,
  type ProjectHistory,
} from "@/features/videoEditor/lib/projectHistory";
import type { Project } from "@/features/videoEditor/lib/timeline";

/** Long enough that a drag's last frames land in one save, short enough to lose little. */
export const AUTOSAVE_DELAY_MS = 800;

export type ProjectSaveState = "new" | "unsaved" | "saving" | "saved" | "error" | "conflict";

export interface VideoProjectState {
  project: Project;
  path: string | null;
  folder: string;
  sources: VideoProjectSourceStatus[];
  saveState: ProjectSaveState;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Every edit goes through ``commit``, or ``preview`` while a gesture runs and then ``commit``:
   * the gesture becomes one undo step from where its first preview started. See projectHistory.
   */
  preview: (next: Project) => void;
  commit: (next: Project) => void;
  /** Changes that are not edits; see ``amendAll``. Returns the project as it now stands. */
  amend: (update: (project: Project) => Project) => Project;
  undo: () => void;
  redo: () => void;
  /** Saves anything pending now; resolves false when the save did not succeed. */
  flush: () => Promise<boolean>;
  /** After a conflict: keep these edits as a new draft instead of overwriting. */
  saveAsCopy: () => Promise<boolean>;
  setSources: (sources: VideoProjectSourceStatus[]) => void;
  /** Replaces everything with another document, e.g. a draft opened from the Projects list. */
  load: (document: VideoProjectDocument) => void;
}

export function useVideoProject(initial: VideoProjectDocument): VideoProjectState {
  const [path, setPath] = useState<string | null>(initial.path ?? null);
  const [folder, setFolder] = useState(initial.folder);
  const [sources, setSources] = useState(initial.sources);
  const [saveState, setSaveState] = useState<ProjectSaveState>(initial.path ? "saved" : "new");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Kept in a ref and mirrored into state: updaters with side effects run twice in StrictMode.
  const historyRef = useRef<ProjectHistory | null>(null);
  historyRef.current ??= startHistory(initial.project);
  const [history, setHistory] = useState(historyRef.current);

  const pathRef = useRef<string | null>(initial.path ?? null);
  const folderRef = useRef(initial.folder);
  const revisionRef = useRef<number | null>(initial.path ? initial.project.revision : null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const blockedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  /** Saves are chained, so a slow one can never land after, and undo, a newer one. */
  const save = useCallback((asCopy = false): Promise<boolean> => {
    clearTimer();
    const run = async (): Promise<boolean> => {
      if (!dirtyRef.current && !asCopy) return true;
      if (blockedRef.current && !asCopy) return false;
      const snapshot = settledProject(historyRef.current!);
      setSaveState("saving");
      try {
        const response = await saveVideoProject(
          folderRef.current,
          asCopy ? null : pathRef.current,
          asCopy ? null : revisionRef.current,
          snapshot,
        );
        pathRef.current = response.path;
        revisionRef.current = response.revision;
        blockedRef.current = false;
        setPath(response.path);
        setSaveError(null);
        if (settledProject(historyRef.current!) === snapshot) {
          dirtyRef.current = false;
          setSaveState("saved");
        } else {
          setSaveState("unsaved");
        }
        return true;
      } catch (error) {
        const conflict = error instanceof ApiError && error.status === 409;
        blockedRef.current = conflict;
        setSaveState(conflict ? "conflict" : "error");
        setSaveError(formatApiError(error));
        return false;
      }
    };
    chainRef.current = chainRef.current.then(run, run);
    return chainRef.current;
  }, []);

  const schedule = useCallback(() => {
    dirtyRef.current = true;
    if (!blockedRef.current) setSaveState("unsaved");
    clearTimer();
    timerRef.current = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }, [save]);

  /** Saves only when what a save would write changed; a preview alone never does. */
  const update = useCallback(
    (next: ProjectHistory) => {
      const before = settledProject(historyRef.current!);
      historyRef.current = next;
      setHistory(next);
      if (settledProject(next) !== before) schedule();
    },
    [schedule],
  );

  const preview = useCallback(
    (next: Project) => update(previewEdit(historyRef.current!, next)),
    [update],
  );
  const commit = useCallback(
    (next: Project) => update(commitEdit(historyRef.current!, next)),
    [update],
  );
  const amend = useCallback(
    (change: (project: Project) => Project) => {
      update(amendAll(historyRef.current!, change));
      return historyRef.current!.present;
    },
    [update],
  );
  const undo = useCallback(() => update(undoEdit(historyRef.current!)), [update]);
  const redo = useCallback(() => update(redoEdit(historyRef.current!)), [update]);
  const settle = useCallback(() => update(settleGesture(historyRef.current!)), [update]);

  const flush = useCallback(() => {
    settle();
    return save();
  }, [save, settle]);
  const saveAsCopy = useCallback(() => {
    dirtyRef.current = true;
    return save(true);
  }, [save]);

  const load = useCallback((document: VideoProjectDocument) => {
    clearTimer();
    dirtyRef.current = false;
    blockedRef.current = false;
    pathRef.current = document.path ?? null;
    folderRef.current = document.folder;
    revisionRef.current = document.path ? document.project.revision : null;
    historyRef.current = startHistory(document.project);
    setHistory(historyRef.current);
    setPath(document.path ?? null);
    setFolder(document.folder);
    setSources(document.sources);
    setSaveError(null);
    setSaveState(document.path ? "saved" : "new");
  }, []);

  // A pending save, or a gesture never let go, must not be lost when the editor unmounts.
  useEffect(
    () => () => {
      const before = settledProject(historyRef.current!);
      historyRef.current = settleGesture(historyRef.current!);
      if (historyRef.current.present !== before) dirtyRef.current = true;
      if (dirtyRef.current) void save();
    },
    [save],
  );

  return {
    project: history.present,
    path,
    folder,
    sources,
    saveState,
    saveError,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    preview,
    commit,
    amend,
    undo,
    redo,
    flush,
    saveAsCopy,
    setSources,
    load,
  };
}
