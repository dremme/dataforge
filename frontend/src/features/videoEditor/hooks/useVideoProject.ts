import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, formatApiError } from "@/shared/api/http";
import type { VideoProjectDocument, VideoProjectSourceStatus } from "@/shared/types";
import { saveVideoProject } from "@/features/videoEditor/api/videoProjects";
import type { Project } from "@/features/videoEditor/lib/timeline";

/** Long enough that a drag's last frames land in one save, short enough to lose little. */
export const AUTOSAVE_DELAY_MS = 800;
const HISTORY_LIMIT = 200;

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
  /** Shows a change without recording it; a drag calls this, then ``commit`` once. */
  preview: (next: Project) => void;
  /** Records the change as one undo step. ``from`` is the state before a previewed drag. */
  commit: (next: Project, from?: Project) => void;
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
  const [project, setProject] = useState<Project>(initial.project);
  const [path, setPath] = useState<string | null>(initial.path ?? null);
  const [folder, setFolder] = useState(initial.folder);
  const [sources, setSources] = useState(initial.sources);
  const [saveState, setSaveState] = useState<ProjectSaveState>(initial.path ? "saved" : "new");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Kept in a ref and mirrored into state: updaters with side effects run twice in StrictMode.
  const historyRef = useRef<{ past: Project[]; future: Project[] }>({ past: [], future: [] });
  const [history, setHistory] = useState(historyRef.current);

  const projectRef = useRef(project);
  projectRef.current = project;
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
      const snapshot = projectRef.current;
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
        if (projectRef.current === snapshot) {
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

  const preview = useCallback((next: Project) => setProject(next), []);

  const commit = useCallback(
    (next: Project, from?: Project) => {
      const before = from ?? projectRef.current;
      if (next === before) {
        setProject(next);
        return;
      }
      historyRef.current = {
        past: [...historyRef.current.past, before].slice(-HISTORY_LIMIT),
        future: [],
      };
      setHistory(historyRef.current);
      setProject(next);
      projectRef.current = next;
      schedule();
    },
    [schedule],
  );

  const undo = useCallback(() => {
    const current = historyRef.current;
    const previous = current.past.at(-1);
    if (!previous) return;
    historyRef.current = {
      past: current.past.slice(0, -1),
      future: [projectRef.current, ...current.future],
    };
    projectRef.current = previous;
    setHistory(historyRef.current);
    setProject(previous);
    schedule();
  }, [schedule]);

  const redo = useCallback(() => {
    const current = historyRef.current;
    const following = current.future[0];
    if (!following) return;
    historyRef.current = {
      past: [...current.past, projectRef.current],
      future: current.future.slice(1),
    };
    projectRef.current = following;
    setHistory(historyRef.current);
    setProject(following);
    schedule();
  }, [schedule]);

  const flush = useCallback(() => save(), [save]);
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
    projectRef.current = document.project;
    setProject(document.project);
    setPath(document.path ?? null);
    setFolder(document.folder);
    setSources(document.sources);
    historyRef.current = { past: [], future: [] };
    setHistory(historyRef.current);
    setSaveError(null);
    setSaveState(document.path ? "saved" : "new");
  }, []);

  // A pending save must not be lost when the editor unmounts without a flush.
  useEffect(
    () => () => {
      if (timerRef.current !== null && dirtyRef.current) void save();
    },
    [save],
  );

  return {
    project,
    path,
    folder,
    sources,
    saveState,
    saveError,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    preview,
    commit,
    undo,
    redo,
    flush,
    saveAsCopy,
    setSources,
    load,
  };
}
