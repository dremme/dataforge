import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  iconArrowLeft,
  iconClapperboard,
  iconLoader2,
  iconTriangleAlert,
  iconX,
} from "@/shared/icons";
import { formatApiError } from "@/shared/api/http";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { matchesShortcut, SHORTCUTS } from "@/shared/lib/shortcuts";
import { readStoredJson, writeStored } from "@/shared/lib/storage";
import { Dialog, DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import type {
  GalleryItem,
  VideoProjectDocument,
  VideoProjectExportSettings,
  VideoProjectSourceInfo,
} from "@/shared/types";
import {
  deleteVideoProject,
  newVideoProject,
  openVideoProject,
  probeVideoProjectSource,
  startVideoProject,
  suggestVideoProjectAdjust,
  startVideoProjectExport,
} from "@/features/videoEditor/api/videoProjects";
import { withAuto, withoutAuto } from "@/features/gallery/lib/autoAdjust";
import type { VideoEditorRequest } from "@/features/videoEditor/context/VideoEditorContext";
import { useVideoExports } from "@/features/videoEditor/hooks/useVideoExports";
import {
  useVideoProject,
  type VideoProjectState,
} from "@/features/videoEditor/hooks/useVideoProject";
import { editorMediaKind } from "@/features/videoEditor/lib/mediaKinds";
import { PreviewEngine, type SourceLocation } from "@/features/videoEditor/lib/previewEngine";
import {
  addDissolve,
  addTitle,
  addTrack,
  clipEnd,
  clipLabel,
  deleteClips,
  duplicateClips,
  linkClips,
  placeSource,
  projectDuration,
  removeDissolve,
  rippleDelete,
  setClipDuration,
  setClipSpeed,
  setDissolveDuration,
  snapToFrame,
  splitClips,
  unlinkClips,
  updateClip,
  type Clip,
  type EditResult,
  type Project,
  type TimeRange,
} from "@/features/videoEditor/lib/timeline";
import { ClipInspector } from "./ClipInspector";
import { DeleteVideoProjectDialog } from "./DeleteVideoProjectDialog";
import { EditorTopBar } from "./EditorTopBar";
import { ExportDialog } from "./ExportDialog";
import { MediaBrowser, type MediaView } from "./MediaBrowser";
import {
  PreviewPanel,
  type PreviewMode,
  type SourceRange,
  type SourceTransport,
} from "./PreviewPanel";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { SourceIssues } from "./SourceIssues";
import { Splitter } from "./Splitter";
import { Timeline, TIMELINE_ORIGIN_PX, TRACK_HEADER_PX, type TimelineTool } from "./Timeline";
import { MAX_PX_PER_SECOND, MIN_PX_PER_SECOND, TimelineToolbar } from "./TimelineToolbar";

interface VideoEditorWorkspaceProps {
  request: VideoEditorRequest;
  /** The current folder's files, which the media browser offers and relinking chooses from. */
  items: GalleryItem[];
  onExit: () => void;
  onOpenInGallery: (path: string) => void;
}

const MESSAGE_MS = 7000;
const ZOOM_STEP = 1.5;
const EMPTY_FIT_SECONDS = 20;
const LAYOUT_KEY = "video-editor-layout";

interface Layout {
  browser: number;
  inspector: number;
  timeline: number;
  browserOpen: boolean;
  inspectorOpen: boolean;
  mediaView: MediaView;
  guides: boolean;
}

const DEFAULT_LAYOUT: Layout = {
  browser: 280,
  inspector: 320,
  timeline: 320,
  browserOpen: true,
  inspectorOpen: true,
  mediaView: "grid",
  guides: false,
};

function parseLayout(value: unknown): Layout | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<Layout>;
  const number = (key: "browser" | "inspector" | "timeline") =>
    typeof stored[key] === "number" ? stored[key] : DEFAULT_LAYOUT[key];
  return {
    browser: number("browser"),
    inspector: number("inspector"),
    timeline: number("timeline"),
    browserOpen: stored.browserOpen !== false,
    inspectorOpen: stored.inspectorOpen !== false,
    mediaView: stored.mediaView === "list" ? "list" : "grid",
    guides: stored.guides === true,
  };
}

/** Loads the starting project, then hands over to the session that edits it. */
export function VideoEditorWorkspace({
  request,
  items,
  onExit,
  onOpenInGallery,
}: VideoEditorWorkspaceProps) {
  const [document, setDocument] = useState<VideoProjectDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDocument(null);
    setError(null);
    const load = { video: startVideoProject, project: openVideoProject, new: newVideoProject }[
      request.kind
    ];
    load(request.path)
      .then((loaded) => {
        if (live) setDocument(loaded);
      })
      .catch((caught: unknown) => {
        if (live) setError(formatApiError(caught));
      });
    return () => {
      live = false;
    };
  }, [request.kind, request.path]);

  if (!document) {
    return (
      <ModalShell
        block="video-editor"
        label="Video editor"
        onClose={onExit}
        escape="none"
        scrollLock="video-editor-open"
        nested={false}
        enterAnimation="none"
      >
        <div className="video-editor__loading">
          <div className="video-editor__loading-card">
            <span
              className={`video-editor__loading-mark${error ? " video-editor__loading-mark--error" : ""}`}
              aria-hidden="true"
            >
              <Icon icon={error ? iconTriangleAlert : iconClapperboard} />
            </span>
            {error ? (
              <>
                <p role="alert">
                  The editor could not open{" "}
                  {request.kind === "video" ? "this video" : "the project"}: {error}
                </p>
                <button type="button" className="video-editor__primary-btn" onClick={onExit}>
                  <Icon icon={iconArrowLeft} /> Back to gallery
                </button>
              </>
            ) : (
              <p role="status">
                <Icon icon={iconLoader2} spin /> Opening the editor...
              </p>
            )}
          </div>
        </div>
      </ModalShell>
    );
  }
  return (
    <EditorSession
      document={document}
      items={items}
      onExit={onExit}
      onOpenInGallery={onOpenInGallery}
    />
  );
}

interface EditorSessionProps {
  document: VideoProjectDocument;
  items: GalleryItem[];
  onExit: () => void;
  onOpenInGallery: (path: string) => void;
}

function sourceLocations(
  statuses: VideoProjectState["sources"],
  sources: Project["sources"],
): Map<string, SourceLocation> {
  const locations = new Map<string, SourceLocation>();
  for (const status of statuses) {
    const source = sources.find((item) => item.id === status.source_id);
    locations.set(status.source_id, {
      path: status.path,
      version: source ? `${source.size}-${source.modified_us}` : "",
      missing: status.state === "missing",
    });
  }
  return locations;
}

/** Every clip edge and the project's start, in order, for jumping from one edit to the next. */
function editPoints(project: Project): number[] {
  const points = new Set<number>([0]);
  for (const clip of project.clips) {
    points.add(clip.start);
    points.add(clipEnd(clip));
  }
  return [...points].sort((a, b) => a - b);
}

function clampZoom(value: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, value));
}

function EditorSession({ document, items, onExit, onOpenInGallery }: EditorSessionProps) {
  const state = useVideoProject(document);
  const { project } = state;
  const [engine] = useState(() => new PreviewEngine());
  const [selection, setSelectionState] = useState<Set<string>>(new Set());
  const [transitionId, setTransitionId] = useState<string | null>(null);
  // Choosing clips always lets go of a chosen dissolve, so the inspector shows the clips.
  const setSelection = useCallback((ids: Set<string>) => {
    setSelectionState(ids);
    if (ids.size > 0) setTransitionId(null);
  }, []);
  const [range, setRange] = useState<TimeRange | null>(null);
  const [tool, setTool] = useState<TimelineTool>("select");
  const [snapping, setSnapping] = useState(true);
  const [pxPerSecond, setPxPerSecond] = useState(40);
  const [message, setMessage] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("timeline");
  const [sourceItem, setSourceItem] = useState<GalleryItem | null>(null);
  const [sourceRange, setSourceRange] = useState<SourceRange>({ start: 0, end: null });
  const [browserTab, setBrowserTab] = useState<"media" | "projects">("media");
  const [layout, setLayout] = useState<Layout>(() =>
    readStoredJson(LAYOUT_KEY, parseLayout, DEFAULT_LAYOUT),
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoPending, setAutoPending] = useState<Set<string>>(new Set());
  const [exportIds, setExportIds] = useState<string[]>([]);
  const timelineBoxRef = useRef<HTMLDivElement>(null);
  const transientBase = useRef<Project | null>(null);
  const sourceTransportRef = useRef<SourceTransport | null>(null);
  const { exports, track, cancel, dismiss } = useVideoExports();

  const dialogOpen = exportOpen || settingsOpen || leaveOpen || deleteOpen;
  const locations = useMemo(
    () => sourceLocations(state.sources, project.sources),
    [state.sources, project.sources],
  );
  const folderItems = useMemo(
    () => items.filter((item) => editorMediaKind(item.name) !== null),
    [items],
  );
  const usedPaths = useMemo(() => {
    const used = new Set(project.clips.map((clip) => clip.source_id));
    return new Set(
      state.sources.filter((status) => used.has(status.source_id)).map((status) => status.path),
    );
  }, [project.clips, state.sources]);
  const selectedClips = project.clips.filter((clip) => selection.has(clip.id));
  const duration = projectDuration(project);

  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => engine.setProject(project, locations), [engine, project, locations]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => writeStored(LAYOUT_KEY, JSON.stringify(layout)), [layout]);

  const zoom = useCallback((value: number) => setPxPerSecond(clampZoom(value)), []);

  const fitTimeline = useCallback(() => {
    const box = timelineBoxRef.current?.clientWidth ?? 900;
    const width = box - TRACK_HEADER_PX - TIMELINE_ORIGIN_PX - 32;
    // An empty project shows a stretch of time to drop into, not one second at full zoom.
    const shown = duration > 0 ? Math.max(duration * 1.05, 1) : EMPTY_FIT_SECONDS;
    zoom(Math.max(width, 200) / shown);
  }, [duration, zoom]);

  // Fit once the first project is laid out; zooming is the user's from then on.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    fitTimeline();
  }, [fitTimeline]);

  const apply = useCallback(
    (result: EditResult, from?: Project): boolean => {
      if (result.project) {
        state.commit(result.project, from);
        setMessage(null);
        return true;
      }
      setMessage(result.error);
      return false;
    },
    [state],
  );

  /** Previews while a control is held and records one undo step when it is let go. */
  const applyTransient = useCallback(
    (result: EditResult, final: boolean) => {
      if (!result.project) {
        setMessage(result.error);
        return;
      }
      if (!transientBase.current) transientBase.current = project;
      if (final) {
        state.commit(result.project, transientBase.current);
        transientBase.current = null;
      } else {
        state.preview(result.project);
      }
    },
    [project, state],
  );

  const deleteSelection = useCallback(() => {
    if (transitionId) {
      if (apply(removeDissolve(project, transitionId))) setTransitionId(null);
      return;
    }
    if (selection.size === 0) {
      setMessage("Select clips to delete, or mark a range and use Ripple delete.");
      return;
    }
    if (apply(deleteClips(project, selection))) setSelection(new Set());
  }, [apply, project, selection, setSelection, transitionId]);

  const ripple = useCallback(() => {
    if (!range || range.end - range.start <= 0) {
      setMessage("Mark a range first: drag with the Range tool, or press I and O.");
      return;
    }
    if (apply(rippleDelete(project, range))) {
      setRange(null);
      setSelection(new Set());
    }
  }, [apply, project, range, setSelection]);

  const split = useCallback(() => {
    const time = snapToFrame(engine.currentTime, project.frame_rate);
    apply(splitClips(project, time, selection.size ? selection : undefined));
  }, [apply, engine, project, selection]);

  const duplicate = useCallback(() => {
    const result = duplicateClips(project, selection);
    if (apply(result) && result.copies) setSelection(new Set(result.copies));
  }, [apply, project, selection, setSelection]);

  const insertTitle = useCallback(() => {
    const result = addTitle(project, snapToFrame(engine.currentTime, project.frame_rate));
    if (apply(result) && result.placed) setSelection(new Set(result.placed));
  }, [apply, engine, project, setSelection]);

  const seekTimeline = useCallback(
    (time: number) => {
      setPreviewMode("timeline");
      engine.seek(time);
    },
    [engine],
  );

  const addSource = useCallback(
    async (path: string, start: number, trackId?: string, sourceRangeArg?: SourceRange) => {
      setBusy(true);
      try {
        const info: VideoProjectSourceInfo = await probeVideoProjectSource(path);
        const result = placeSource(project, {
          info,
          start,
          trackId,
          rangeIn: sourceRangeArg?.start,
          rangeOut: sourceRangeArg?.end ?? undefined,
        });
        if (apply(result) && result.placed) {
          const placedSource = result.project?.clips.find((clip) => clip.id === result.placed?.[0]);
          const sourceId = placedSource?.source_id;
          if (sourceId && !state.sources.some((status) => status.source_id === sourceId)) {
            state.setSources([
              ...state.sources,
              { source_id: sourceId, state: "ok", path: info.path },
            ]);
          }
          setSelection(new Set(result.placed));
          setPreviewMode("timeline");
        }
      } catch (caught) {
        setMessage(formatApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [apply, project, setSelection, state],
  );

  // The answer lands on the latest project, so edits made while the wand reads are kept.
  const projectRef = useRef(project);
  projectRef.current = project;

  /** Reads the clip's take of its source as it is now and composes the suggestion onto it. */
  const autoAdjustClip = useCallback(
    async (clip: Clip) => {
      const location = clip.source_id ? locations.get(clip.source_id) : undefined;
      if (!location || location.missing) {
        setMessage("Relink this clip's source before using Auto.");
        return;
      }
      setAutoPending((current) => new Set(current).add(clip.id));
      try {
        const { suggestion } = await suggestVideoProjectAdjust({
          path: location.path,
          start: clip.source_in,
          end: clip.kind === "video" ? clip.source_in + clip.duration * clip.speed : null,
          crop: clip.crop ?? null,
        });
        const latest = projectRef.current;
        const current = latest.clips.find((item) => item.id === clip.id);
        if (!current) return;
        const base = current.auto_adjust
          ? withoutAuto(current.adjust, current.auto_adjust)
          : current.adjust;
        const { adjust, autoAdjust } = withAuto(base, suggestion);
        apply(updateClip(latest, clip.id, { adjust, auto_adjust: autoAdjust }));
      } catch (caught) {
        setMessage(`Auto could not read ${clipLabel(project, clip)}: ${formatApiError(caught)}`);
      } finally {
        setAutoPending((current) => {
          const next = new Set(current);
          next.delete(clip.id);
          return next;
        });
      }
    },
    [apply, locations, project],
  );

  const requestExit = useCallback(async () => {
    engine.pause();
    if (await state.flush()) onExit();
    else setLeaveOpen(true);
  }, [engine, onExit, state]);

  const openDraft = useCallback(
    async (path: string) => {
      if (!(await state.flush())) {
        setMessage("Save this project before opening another; it has unsaved changes.");
        return;
      }
      try {
        const opened = await openVideoProject(path);
        engine.pause();
        state.load(opened);
        setSelection(new Set());
        setTransitionId(null);
        setRange(null);
        engine.seek(0);
        fittedRef.current = false;
      } catch (caught) {
        setMessage(formatApiError(caught));
      }
    },
    [engine, setSelection, state],
  );

  const resolveSource = useCallback(
    async (sourceId: string, path: string) => {
      setBusy(true);
      try {
        const info = await probeVideoProjectSource(path);
        const sources = project.sources.map((source) =>
          source.id === sourceId
            ? {
                ...source,
                name: info.name,
                size: info.size,
                modified_us: info.modified_us,
                duration: info.duration ?? null,
                width: info.width ?? null,
                height: info.height ?? null,
                frame_rate: info.frame_rate ?? null,
                has_audio: info.has_audio,
              }
            : source,
        );
        if (sources.some((source) => source.id !== sourceId && source.name === info.name)) {
          setMessage(`${info.name} is already a source of this project; relink to another file.`);
          return;
        }
        state.commit({ ...project, sources });
        state.setSources(
          state.sources.map((status) =>
            status.source_id === sourceId ? { ...status, state: "ok", path: info.path } : status,
          ),
        );
      } catch (caught) {
        setMessage(formatApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [project, state],
  );

  const usedIssues = state.sources.filter(
    (status) =>
      status.state !== "ok" && project.clips.some((clip) => clip.source_id === status.source_id),
  );
  const exportBlocked = usedIssues.length
    ? "Relink or accept the sources listed above the timeline before exporting."
    : duration <= 0
      ? "The timeline is empty."
      : null;

  const startExport = useCallback(
    async (settings: VideoProjectExportSettings) => {
      const next = { ...project, export: settings };
      state.commit(next);
      setExportBusy(true);
      setExportError(null);
      try {
        const started = await startVideoProjectExport(state.folder, state.path, next);
        track(started);
        setExportIds((current) => [started.id, ...current]);
        setExportOpen(false);
      } catch (caught) {
        setExportError(formatApiError(caught));
      } finally {
        setExportBusy(false);
      }
    },
    [project, state, track],
  );

  /** I and O on the timeline mark the range a ripple delete removes, like a source's in and out. */
  const markTimeline = useCallback(
    (edge: "in" | "out") => {
      const time = snapToFrame(engine.currentTime, project.frame_rate);
      setRange((current) =>
        edge === "in"
          ? { start: time, end: current && current.end > time ? current.end : time }
          : { start: current && current.start < time ? current.start : 0, end: time },
      );
    },
    [engine, project.frame_rate],
  );

  // Keys reach the editor only outside text fields and while none of its dialogs is open.
  const keysRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (event: KeyboardEvent) => {
    if (dialogOpen || menuOpen || event.defaultPrevented || isEditableTarget(event.target)) return;
    const frame = 1 / project.frame_rate;
    const source = previewMode === "source" ? sourceTransportRef.current : null;
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    const jump = (direction: -1 | 1) => {
      const now = engine.currentTime;
      const points = editPoints(project);
      const target =
        direction > 0
          ? points.find((point) => point > now + 1e-4)
          : [...points].reverse().find((point) => point < now - 1e-4);
      if (target !== undefined) seekTimeline(target);
    };
    const step = (frames: -1 | 1) =>
      source
        ? source.step(frames)
        : engine.seek(snapToFrame(engine.currentTime + frames * frame, project.frame_rate));
    if (matchesShortcut(event, SHORTCUTS.editorPlayPause))
      run(() => (source ? source.toggle() : engine.toggle()));
    else if (matchesShortcut(event, SHORTCUTS.editorStepBack)) run(() => step(-1));
    else if (matchesShortcut(event, SHORTCUTS.editorStepForward)) run(() => step(1));
    else if (matchesShortcut(event, SHORTCUTS.editorGoToStart))
      run(() => (source ? source.seekToEdge("start") : engine.seek(0)));
    else if (matchesShortcut(event, SHORTCUTS.editorGoToEnd))
      run(() => (source ? source.seekToEdge("end") : engine.seek(duration)));
    else if (matchesShortcut(event, SHORTCUTS.editorPreviousEdit)) run(() => jump(-1));
    else if (matchesShortcut(event, SHORTCUTS.editorNextEdit)) run(() => jump(1));
    else if (matchesShortcut(event, SHORTCUTS.editorMarkIn))
      run(() => (source ? source.markIn() : markTimeline("in")));
    else if (matchesShortcut(event, SHORTCUTS.editorMarkOut))
      run(() => (source ? source.markOut() : markTimeline("out")));
    else if (matchesShortcut(event, SHORTCUTS.editorClearMarks)) {
      if (source) {
        run(() => setSourceRange({ start: 0, end: null }));
      } else if (range || selection.size > 0 || transitionId) {
        run(() => {
          setRange(null);
          setSelectionState(new Set());
          setTransitionId(null);
        });
      }
    } else if (matchesShortcut(event, SHORTCUTS.editorSelectTool)) run(() => setTool("select"));
    else if (matchesShortcut(event, SHORTCUTS.editorBladeTool)) run(() => setTool("blade"));
    else if (matchesShortcut(event, SHORTCUTS.editorRangeTool)) run(() => setTool("range"));
    else if (matchesShortcut(event, SHORTCUTS.editorSnapping)) run(() => setSnapping((on) => !on));
    else if (matchesShortcut(event, SHORTCUTS.editorZoomIn))
      run(() => zoom(pxPerSecond * ZOOM_STEP));
    else if (matchesShortcut(event, SHORTCUTS.editorZoomOut))
      run(() => zoom(pxPerSecond / ZOOM_STEP));
    else if (matchesShortcut(event, SHORTCUTS.editorZoomFit)) run(fitTimeline);
    else if (matchesShortcut(event, SHORTCUTS.editorSplit)) run(split);
    else if (matchesShortcut(event, SHORTCUTS.editorRippleDelete)) run(ripple);
    else if (matchesShortcut(event, SHORTCUTS.editorDelete)) run(deleteSelection);
    else if (matchesShortcut(event, SHORTCUTS.editorDuplicate)) run(duplicate);
    else if (matchesShortcut(event, SHORTCUTS.editorRedo)) run(state.redo);
    else if (matchesShortcut(event, SHORTCUTS.editorUndo)) run(state.undo);
  };
  // A layout effect, so a key pressed as the editor first shows is never dropped.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => keysRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const myExports = exports.filter(
    (item) =>
      exportIds.includes(item.id) || (state.path !== null && item.project_path === state.path),
  );
  const latestExport = myExports[0];

  const gridStyle = {
    "--browser-width": layout.browserOpen ? `${layout.browser}px` : "0px",
    "--inspector-width": layout.inspectorOpen ? `${layout.inspector}px` : "0px",
    "--timeline-height": `${layout.timeline}px`,
  } as CSSProperties;

  const resize = (key: "browser" | "inspector" | "timeline", next: (size: number) => number) =>
    setLayout((current) => ({ ...current, [key]: next(current[key]) }));

  return (
    <ModalShell
      block="video-editor"
      label={`Video editor: ${project.name}`}
      onClose={() => void requestExit()}
      escape="none"
      scrollLock="video-editor-open"
      nested={false}
      enterAnimation="none"
      suspended={dialogOpen || menuOpen}
    >
      <div className="video-editor__frame" style={gridStyle}>
        <EditorTopBar
          state={state}
          latestExport={latestExport}
          onCancelExport={() => latestExport && void cancel(latestExport.id)}
          onDismissExport={() => {
            if (!latestExport) return;
            setExportIds((current) => current.filter((id) => id !== latestExport.id));
            void dismiss(latestExport.id);
          }}
          onOpenExport={() => {
            if (!latestExport) return;
            void state.flush().then((saved) => {
              if (saved) onOpenInGallery(latestExport.output_path);
              else setLeaveOpen(true);
            });
          }}
          browserOpen={layout.browserOpen}
          inspectorOpen={layout.inspectorOpen}
          onToggleBrowser={() =>
            setLayout((current) => ({ ...current, browserOpen: !current.browserOpen }))
          }
          onToggleInspector={() =>
            setLayout((current) => ({ ...current, inspectorOpen: !current.inspectorOpen }))
          }
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          onOpenProject={() => {
            setLayout((current) => ({ ...current, browserOpen: true }));
            setBrowserTab("projects");
          }}
          onSettings={() => setSettingsOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onExport={() => {
            setExportError(null);
            setExportOpen(true);
          }}
          canExport={duration > 0}
          onBack={() => void requestExit()}
        />

        <div className="video-editor__workarea">
          {layout.browserOpen && (
            <>
              <MediaBrowser
                tab={browserTab}
                onTab={setBrowserTab}
                folder={state.folder}
                items={folderItems}
                usedPaths={usedPaths}
                view={layout.mediaView}
                onView={(mediaView) => setLayout((current) => ({ ...current, mediaView }))}
                previewing={previewMode === "source" ? (sourceItem?.path ?? null) : null}
                currentProjectPath={state.path}
                onPreview={(item) => {
                  setSourceItem(item);
                  setSourceRange({ start: 0, end: null });
                  setPreviewMode("source");
                  engine.pause();
                }}
                onAdd={(item) => void addSource(item.path, engine.currentTime)}
                onOpenProject={(path) => void openDraft(path)}
              />
              <Splitter
                label="Media browser width"
                orientation="vertical"
                onResize={(delta) => resize("browser", (size) => clampSize(size + delta, 200, 560))}
                onReset={() => resize("browser", () => DEFAULT_LAYOUT.browser)}
              />
            </>
          )}

          <PreviewPanel
            mode={previewMode}
            onModeChange={(mode) => {
              setPreviewMode(mode);
              if (mode === "source") engine.pause();
            }}
            engine={engine}
            project={project}
            selectedClip={selectedClips.length === 1 ? selectedClips[0] : null}
            onTransform={(clip, transform, final) =>
              applyTransient(updateClip(project, clip.id, { transform }), final)
            }
            sourceItem={sourceItem}
            sourceRange={sourceRange}
            onSourceRange={setSourceRange}
            onAddSource={() =>
              sourceItem &&
              void addSource(sourceItem.path, engine.currentTime, undefined, sourceRange)
            }
            sourceTransportRef={sourceTransportRef}
            hasMissing={state.sources.some((status) => status.state === "missing")}
            guides={layout.guides}
            onGuides={() => setLayout((current) => ({ ...current, guides: !current.guides }))}
          />

          {layout.inspectorOpen && (
            <>
              <Splitter
                label="Inspector width"
                orientation="vertical"
                onResize={(delta) =>
                  resize("inspector", (size) => clampSize(size - delta, 240, 560))
                }
                onReset={() => resize("inspector", () => DEFAULT_LAYOUT.inspector)}
              />
              <aside
                className="video-editor__inspector video-editor__pane"
                aria-label="Clip inspector"
              >
                <div className="video-editor__pane-header">
                  <span className="video-editor__pane-title">Inspector</span>
                </div>
                <div className="video-editor__inspector-scroll" data-scroll-lock-allow>
                  <ClipInspector
                    project={project}
                    selection={selectedClips}
                    transitionId={transitionId}
                    onEdit={(patch, final) => {
                      if (selectedClips.length === 1) {
                        applyTransient(updateClip(project, selectedClips[0].id, patch), final);
                      }
                    }}
                    onSpeed={(speed) =>
                      selectedClips[0] && apply(setClipSpeed(project, selectedClips[0].id, speed))
                    }
                    onDuration={(seconds) =>
                      selectedClips[0] &&
                      apply(setClipDuration(project, selectedClips[0].id, seconds))
                    }
                    onUnlink={() => apply(unlinkClips(project, selection))}
                    onLink={() => apply(linkClips(project, selection))}
                    onAddDissolve={() => {
                      const result = addDissolve(project, selectedClips[0]?.id ?? "");
                      if (apply(result) && result.project) {
                        setTransitionId(result.project.transitions.at(-1)?.id ?? null);
                        setSelection(new Set());
                      }
                    }}
                    onDissolveDuration={(seconds, final) =>
                      transitionId &&
                      applyTransient(setDissolveDuration(project, transitionId, seconds), final)
                    }
                    onRemoveDissolve={() => {
                      if (transitionId && apply(removeDissolve(project, transitionId)))
                        setTransitionId(null);
                    }}
                    onDelete={deleteSelection}
                    autoPending={selectedClips.length === 1 && autoPending.has(selectedClips[0].id)}
                    onAuto={() => selectedClips[0] && void autoAdjustClip(selectedClips[0])}
                  />
                </div>
              </aside>
            </>
          )}
        </div>

        <Splitter
          label="Timeline height"
          orientation="horizontal"
          onResize={(delta) => resize("timeline", (size) => clampSize(size - delta, 180, 680))}
          onReset={() => resize("timeline", () => DEFAULT_LAYOUT.timeline)}
        />

        <section
          className="video-editor__timeline video-editor__pane"
          ref={timelineBoxRef}
          aria-label="Timeline"
        >
          <TimelineToolbar
            project={project}
            tool={tool}
            onTool={setTool}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onUndo={state.undo}
            onRedo={state.redo}
            onSplit={split}
            canDuplicate={selection.size > 0}
            onDuplicate={duplicate}
            canDelete={selection.size > 0 || transitionId !== null}
            onDelete={deleteSelection}
            range={range}
            onRipple={ripple}
            onClearRange={() => setRange(null)}
            onAddTitle={insertTitle}
            onAddVideoTrack={() => apply(addTrack(project, "video"))}
            onAddAudioTrack={() => apply(addTrack(project, "audio"))}
            snapping={snapping}
            onSnapping={() => setSnapping((on) => !on)}
            pxPerSecond={pxPerSecond}
            onZoom={zoom}
            onFit={fitTimeline}
          />
          <SourceIssues
            project={project}
            statuses={state.sources}
            items={folderItems}
            busy={busy}
            onRelink={(sourceId, item) => void resolveSource(sourceId, item.path)}
            onAccept={(sourceId) => {
              const status = state.sources.find((item) => item.source_id === sourceId);
              if (status) void resolveSource(sourceId, status.path);
            }}
          />
          <div className="video-editor__timeline-body">
            {message && (
              <p className="video-editor__toast" role="alert">
                <Icon icon={iconTriangleAlert} />
                <span>{message}</span>
                <button
                  type="button"
                  className="video-editor__icon-btn"
                  aria-label="Dismiss"
                  onClick={() => setMessage(null)}
                >
                  <Icon icon={iconX} />
                </button>
              </p>
            )}
            <Timeline
              project={project}
              engine={engine}
              sources={locations}
              selection={selection}
              selectedTransition={transitionId}
              range={range}
              tool={tool}
              snapping={snapping}
              pxPerSecond={pxPerSecond}
              onSelect={(ids, transition) => {
                setSelectionState(ids);
                setTransitionId(transition ?? null);
              }}
              onRange={setRange}
              onPreview={state.preview}
              onCommit={(next, from) => state.commit(next, from)}
              onError={setMessage}
              onSeek={seekTimeline}
              onDropSource={(path, time, trackId) => void addSource(path, time, trackId)}
              onTracks={(next) => state.commit(next)}
              onZoom={zoom}
            />
          </div>
        </section>
      </div>

      {exportOpen && (
        <ExportDialog
          project={project}
          busy={exportBusy}
          error={exportError}
          blocked={exportBlocked}
          onExport={(settings) => void startExport(settings)}
          onCancel={() => setExportOpen(false)}
        />
      )}
      {deleteOpen && state.path && (
        <DeleteVideoProjectDialog
          name={project.name}
          onClose={() => setDeleteOpen(false)}
          onDelete={async () => {
            const path = state.path;
            if (!path) return;
            engine.pause();
            // Pending edits land first, so no save can write the file back after it is gone.
            await state.flush();
            await deleteVideoProject(path);
            onExit();
          }}
        />
      )}
      {settingsOpen && (
        <ProjectSettingsDialog
          project={project}
          onCancel={() => setSettingsOpen(false)}
          onSave={(patch) => {
            state.commit({ ...project, ...patch });
            setSettingsOpen(false);
          }}
        />
      )}
      {leaveOpen && (
        <Dialog
          title="Your latest changes are not saved"
          description={
            <>
              {state.saveError ?? "The project could not be saved."} Try saving again, stay in the
              editor, or leave and lose the changes made since the last save.
            </>
          }
          onClose={() => setLeaveOpen(false)}
          footer={
            <>
              <DialogButton label="Leave without saving" variant="danger" onClick={onExit} />
              <DialogButton
                label="Stay in editor"
                variant="secondary"
                onClick={() => setLeaveOpen(false)}
              />
              <DialogButton
                label={state.saveState === "conflict" ? "Save as a new draft" : "Retry save"}
                variant="primary"
                onClick={() => {
                  const save = state.saveState === "conflict" ? state.saveAsCopy() : state.flush();
                  void save.then((saved) => {
                    if (saved) onExit();
                  });
                }}
              />
            </>
          }
        />
      )}
    </ModalShell>
  );
}

function clampSize(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
