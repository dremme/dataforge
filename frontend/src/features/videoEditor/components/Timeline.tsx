import { Tooltip } from "@/shared/ui/Tooltip";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  iconChevronDown,
  iconChevronRight,
  iconChevronUp,
  iconEye,
  iconEyeOff,
  iconHeadphones,
  iconLink,
  iconLink2,
  iconLink2Off,
  iconLock,
  iconLockOpen,
  iconTrash2,
  iconTriangleAlert,
  iconType,
  iconVolume2,
  iconVolumeX,
} from "@/shared/icons";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { filmstripUrl, waveformUrl } from "@/features/videoEditor/api/videoProjects";
import { usePlayheadTime } from "@/features/videoEditor/hooks/usePlayhead";
import type { PreviewEngine, SourceLocation } from "@/features/videoEditor/lib/previewEngine";
import {
  clipValueAt,
  keyframeTimes,
  type AnimatedProperty,
} from "@/features/videoEditor/lib/keyframes";
import {
  clipEnd,
  clipLabel,
  clipTrackKind,
  EPSILON,
  formatTimecode,
  moveClipsFlush,
  moveTrack,
  projectDuration,
  removeTrack,
  snapBlockDelta,
  snapTargets,
  snapTo,
  snapToFrame,
  sourceById,
  splitClips,
  trackById,
  tracksOfKind,
  transitionOverlap,
  trimClipFlush,
  updateTrack,
  withLinked,
  type Clip,
  type EditResult,
  type Project,
  type TimeRange,
  type Track,
  type TrimEdge,
} from "@/features/videoEditor/lib/timeline";
import { markerLabel } from "@/features/videoEditor/lib/markers";
import {
  clipTiles,
  tileSeconds,
  type MediaTile,
  type TileLevel,
} from "@/features/videoEditor/lib/mediaTiles";
import { rippleTrim, rollTrim } from "@/features/videoEditor/lib/trimming";
import { thumbnailUrl } from "@/features/gallery/api/media";
import { ToolButton } from "./ToolButton";

export type TimelineTool = "select" | "blade" | "range" | "ripple" | "roll";

/** Tools whose clips select and move as with Select; they differ only in what an edge does. */
const EDGE_TOOLS: ReadonlySet<TimelineTool> = new Set(["select", "ripple", "roll"]);

/** Drag-and-drop payload type of a media browser row. */
export const SOURCE_DRAG_TYPE = "application/x-dataforge-editor-source";

/** Width of the track header column; the stylesheet's `$header-width` matches it. */
export const TRACK_HEADER_PX = 184;
/** Room before 00:00, so the playhead and a clip's first edge never sit under the headers. */
export const TIMELINE_ORIGIN_PX = 12;
/** Both fit the header's two rows of controls inside its padding. */
const VIDEO_LANE_PX = 60;
const AUDIO_LANE_PX = 56;
/** A collapsed lane fits one row of clip names, matching the header's single row. */
const COLLAPSED_LANE_PX = 28;
const SNAP_PX = 8;
/** Seconds of empty timeline after the last clip, so there is room to drop and drag. */
const TAIL_SECONDS = 10;
const FILMSTRIP_FRAME_PX = 72;
const FILMSTRIP_HEIGHT = 48;
/** How long the zoom and the scroll position rest before the clips' pictures follow them. */
const LEVEL_SETTLE_MS = 300;
const SCROLL_SETTLE_MS = 120;
/** How far ahead of the right edge the view pages forward while playing. */
const FOLLOW_MARGIN_PX = 32;
/** Frames get their own ruler ticks once one is this wide. */
const FRAME_TICK_PX = 6;
/** A press on empty lane space becomes a marquee once the pointer travels this far. */
const MARQUEE_PX = 4;

interface TimelineProps {
  project: Project;
  engine: PreviewEngine;
  sources: Map<string, SourceLocation>;
  selection: Set<string>;
  selectedTransition: string | null;
  range: TimeRange | null;
  tool: TimelineTool;
  snapping: boolean;
  pxPerSecond: number;
  onSelect: (ids: Set<string>, transition?: string | null) => void;
  onRange: (range: TimeRange | null) => void;
  onPreview: (project: Project) => void;
  onCommit: (next: Project) => void;
  onError: (message: string) => void;
  onSeek: (time: number) => void;
  onDropSource: (path: string, time: number, trackId: string) => void;
  onTracks: (next: Project) => void;
  onZoom: (pxPerSecond: number) => void;
}

type Drag =
  | {
      kind: "move";
      base: Project;
      clipId: string;
      ids: Set<string>;
      originX: number;
      originY: number;
      /** The last position the edit could take; `error` says why the pointer's own cannot. */
      result: EditResult | null;
      error?: string;
    }
  | {
      kind: "trim";
      tool: TimelineTool;
      base: Project;
      clipId: string;
      edge: TrimEdge;
      result: EditResult | null;
      error?: string;
    }
  | { kind: "range"; anchor: number }
  | { kind: "scrub" }
  | {
      kind: "marquee";
      /** Where the press began, in the lanes' own pixels. */
      x: number;
      y: number;
      /** Kept when Shift or Ctrl was held, so the marquee adds to it. */
      kept: Set<string>;
      active: boolean;
    };

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function laneHeight(track: Track): number {
  if (track.collapsed) return COLLAPSED_LANE_PX;
  return track.kind === "video" ? VIDEO_LANE_PX : AUDIO_LANE_PX;
}

export function Timeline({
  project,
  engine,
  sources,
  selection,
  selectedTransition,
  range,
  tool,
  snapping,
  pxPerSecond,
  onSelect,
  onRange,
  onPreview,
  onCommit,
  onError,
  onSeek,
  onDropSource,
  onTracks,
  onZoom,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const playheadHeadRef = useRef<HTMLDivElement>(null);
  const bladeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const zoomAnchorRef = useRef<{ time: number; offset: number } | null>(null);
  const shownPxRef = useRef(pxPerSecond);
  const [dragError, setDragError] = useState<string | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ trackId: string; time: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);

  const duration = projectDuration(project);
  const [viewWidth, setViewWidth] = useState(0);
  // The lanes always reach the right edge, however short the project or far out the zoom.
  const contentWidth = Math.max(
    TIMELINE_ORIGIN_PX + (duration + TAIL_SECONDS) * pxPerSecond,
    viewWidth - TRACK_HEADER_PX,
  );
  const at = (time: number) => TIMELINE_ORIGIN_PX + time * pxPerSecond;
  // Pictures follow the zoom once it settles, and the scroll position a moment after it stops.
  const levelPx = useDebouncedValue(pxPerSecond, LEVEL_SETTLE_MS);
  const [scrollLeft, setScrollLeft] = useState(0);
  const settledScroll = useDebouncedValue(scrollLeft, SCROLL_SETTLE_MS);
  const view = useMemo<TimeRange>(() => {
    const lanes = viewWidth - TRACK_HEADER_PX;
    // Before the timeline is measured, everything counts as in view.
    if (lanes <= 0) return { start: 0, end: Infinity };
    const start = (settledScroll - TIMELINE_ORIGIN_PX) / pxPerSecond;
    const seconds = lanes / pxPerSecond;
    return { start: start - seconds, end: start + 2 * seconds };
  }, [settledScroll, viewWidth, pxPerSecond]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => setViewWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    const scrolled = () => setScrollLeft(scroller.scrollLeft);
    scroller.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", scrolled);
    };
  }, []);

  // The line follows the clock without React; while playing, the view pages along with it.
  useEffect(() => {
    const move = (time: number) => {
      const x = TIMELINE_ORIGIN_PX + time * pxPerSecond;
      const transform = `translateX(${x}px)`;
      if (playheadRef.current) playheadRef.current.style.transform = transform;
      if (playheadHeadRef.current) playheadHeadRef.current.style.transform = transform;
      const scroller = scrollRef.current;
      if (!scroller || !engine.isPlaying) return;
      const view = scroller.clientWidth - TRACK_HEADER_PX;
      if (x > scroller.scrollLeft + view - FOLLOW_MARGIN_PX || x < scroller.scrollLeft) {
        scroller.scrollLeft = Math.max(0, x - FOLLOW_MARGIN_PX);
      }
    };
    move(engine.currentTime);
    return engine.subscribe(move);
  }, [engine, pxPerSecond]);

  // A zoom keeps one moment where it was on screen: the pointer's for a wheel zoom, otherwise
  // the playhead when it is in view, otherwise the left edge.
  useLayoutEffect(() => {
    const before = shownPxRef.current;
    shownPxRef.current = pxPerSecond;
    const scroller = scrollRef.current;
    if (!scroller || before === pxPerSecond) return;
    let anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    if (!anchor) {
      const view = scroller.clientWidth - TRACK_HEADER_PX;
      const playX = TIMELINE_ORIGIN_PX + engine.currentTime * before - scroller.scrollLeft;
      anchor =
        playX >= 0 && playX <= view
          ? { time: engine.currentTime, offset: playX }
          : { time: scroller.scrollLeft / before, offset: 0 };
    }
    scroller.scrollLeft = Math.max(
      0,
      TIMELINE_ORIGIN_PX + anchor.time * pxPerSecond - anchor.offset,
    );
  }, [engine, pxPerSecond]);

  // Ctrl/Cmd + wheel zooms around the pointer. A plain wheel scrolls sideways while every track
  // fits, since there is nothing to scroll the other way.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const offset = event.clientX - scroller.getBoundingClientRect().left - TRACK_HEADER_PX;
        zoomAnchorRef.current = { time: timeAt(event.clientX), offset: Math.max(0, offset) };
        onZoom(pxPerSecond * (event.deltaY < 0 ? 1.25 : 0.8));
        return;
      }
      const fits = scroller.scrollHeight <= scroller.clientHeight;
      if (fits && event.deltaX === 0 && event.deltaY !== 0 && !event.shiftKey) {
        event.preventDefault();
        scroller.scrollLeft += event.deltaY;
      }
    };
    scroller.addEventListener("wheel", wheel, { passive: false });
    return () => scroller.removeEventListener("wheel", wheel);
  });

  function timeAt(clientX: number): number {
    const lanes = lanesRef.current;
    if (!lanes) return 0;
    const x = clientX - lanes.getBoundingClientRect().left - TIMELINE_ORIGIN_PX;
    return Math.max(0, x / pxPerSecond);
  }

  /** The track whose lane is under ``clientY``. */
  function trackAt(clientY: number): Track | undefined {
    const lanes = lanesRef.current;
    if (!lanes) return undefined;
    let offset = clientY - lanes.getBoundingClientRect().top;
    if (offset < 0) return undefined;
    for (const track of project.tracks) {
      offset -= laneHeight(track);
      if (offset < 0) return track;
    }
    return undefined;
  }

  function laneTop(trackId: string): number {
    let top = 0;
    for (const track of project.tracks) {
      if (track.id === trackId) return top;
      top += laneHeight(track);
    }
    return top;
  }

  const threshold = SNAP_PX / pxPerSecond;
  const frame = (time: number) => snapToFrame(time, project.frame_rate);

  function startDrag(event: ReactPointerEvent, drag: Drag) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = drag;
    setDragError(null);
    hideBlade();
  }

  /** A point in the lanes' own pixels. */
  function lanePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = lanesRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  /** Every clip whose block on the timeline meets ``box``. */
  function clipsIn(box: Box): Set<string> {
    const ids = new Set<string>();
    for (const clip of project.clips) {
      const track = trackById(project, clip.track_id);
      if (!track) continue;
      const top = laneTop(track.id);
      if (
        at(clipEnd(clip)) > box.left &&
        at(clip.start) < box.left + box.width &&
        top + laneHeight(track) > box.top &&
        top < box.top + box.height
      ) {
        ids.add(clip.id);
      }
    }
    return ids;
  }

  function handleClipPointerDown(event: ReactPointerEvent, clip: Clip) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const time = frame(timeAt(event.clientX));
    if (tool === "blade") {
      const result = splitClips(project, time, [clip.id]);
      if (result.project) onCommit(result.project);
      else onError(result.error);
      return;
    }
    if (tool === "range") {
      startDrag(event, { kind: "range", anchor: time });
      onRange({ start: time, end: time });
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    let ids = selection;
    if (additive) {
      ids = new Set(selection);
      if (ids.has(clip.id)) ids.delete(clip.id);
      else ids.add(clip.id);
      onSelect(ids, null);
      if (!ids.has(clip.id)) return;
    } else if (!selection.has(clip.id)) {
      ids = new Set([clip.id]);
      onSelect(ids, null);
    }
    startDrag(event, {
      kind: "move",
      base: project,
      clipId: clip.id,
      ids,
      originX: event.clientX,
      originY: event.clientY,
      result: null,
    });
  }

  function handleTrimPointerDown(event: ReactPointerEvent, clip: Clip, edge: TrimEdge) {
    if (event.button !== 0 || !EDGE_TOOLS.has(tool)) return;
    event.stopPropagation();
    if (!selection.has(clip.id)) onSelect(new Set([clip.id]), null);
    startDrag(event, { kind: "trim", tool, base: project, clipId: clip.id, edge, result: null });
  }

  function handleLanePointerDown(event: ReactPointerEvent) {
    if (event.button !== 0) return;
    const time = frame(timeAt(event.clientX));
    if (tool === "range") {
      startDrag(event, { kind: "range", anchor: time });
      onRange({ start: time, end: time });
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!additive) onSelect(new Set(), null);
    onSeek(time);
    if (EDGE_TOOLS.has(tool)) {
      startDrag(event, {
        kind: "marquee",
        ...lanePoint(event.clientX, event.clientY),
        kept: additive ? new Set(selection) : new Set(),
        active: false,
      });
    }
  }

  function handleRulerPointerDown(event: ReactPointerEvent) {
    if (event.button !== 0) return;
    startDrag(event, { kind: "scrub" });
    onSeek(frame(timeAt(event.clientX)));
  }

  /** The blade's cut line, drawn over the lane under the pointer without a React render. */
  function showBlade(clientX: number, clientY: number) {
    const line = bladeRef.current;
    const lanes = lanesRef.current;
    if (!line || !lanes) return;
    const track = trackAt(clientY);
    const inside = clientX >= lanes.getBoundingClientRect().left;
    if (!track || !inside) {
      hideBlade();
      return;
    }
    line.style.display = "block";
    line.style.top = `${laneTop(track.id)}px`;
    line.style.height = `${laneHeight(track)}px`;
    line.style.transform = `translateX(${at(frame(timeAt(clientX)))}px)`;
  }

  function hideBlade() {
    if (bladeRef.current) bladeRef.current.style.display = "none";
  }

  function handlePointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) {
      if (tool === "blade") showBlade(event.clientX, event.clientY);
      return;
    }
    const time = timeAt(event.clientX);
    if (drag.kind === "scrub") {
      onSeek(frame(time));
      return;
    }
    if (drag.kind === "range") {
      const end = frame(time);
      onRange({ start: Math.min(drag.anchor, end), end: Math.max(drag.anchor, end) });
      return;
    }
    if (drag.kind === "marquee") {
      const point = lanePoint(event.clientX, event.clientY);
      const width = Math.abs(point.x - drag.x);
      const height = Math.abs(point.y - drag.y);
      if (!drag.active && Math.max(width, height) < MARQUEE_PX) return;
      drag.active = true;
      const box = {
        left: Math.min(point.x, drag.x),
        top: Math.min(point.y, drag.y),
        width,
        height,
      };
      setMarquee(box);
      onSelect(new Set([...drag.kept, ...clipsIn(box)]), null);
      return;
    }
    if (drag.kind === "trim") {
      let target = frame(time);
      let snapped: number | null = null;
      if (snapping) {
        const excluded = withLinked(drag.base, [drag.clipId]);
        snapped = snapTo(target, snapTargets(drag.base, engine.currentTime, excluded), threshold);
        target = snapped ?? target;
      }
      setSnapAt(snapped);
      const trim =
        drag.tool === "ripple" ? rippleTrim : drag.tool === "roll" ? rollTrim : trimClipFlush;
      followDrag(drag, trim(drag.base, drag.clipId, drag.edge, target));
      return;
    }
    const moving = withLinked(drag.base, drag.ids);
    const movingClips = drag.base.clips.filter((clip) => moving.has(clip.id));
    let delta = (event.clientX - drag.originX) / pxPerSecond;
    const first = Math.min(...movingClips.map((clip) => clip.start));
    delta = Math.max(delta, -first);
    let snapped: number | null = null;
    if (snapping) {
      const last = Math.max(...movingClips.map(clipEnd));
      const targets = snapTargets(drag.base, engine.currentTime, moving);
      delta = snapBlockDelta(first, last, delta, targets, threshold);
      snapped =
        [first + delta, last + delta].find((edge) =>
          targets.some((target) => Math.abs(target - edge) < 1e-6),
        ) ?? null;
    } else {
      delta = frame(first + delta) - first;
    }
    setSnapAt(snapped);
    const dragged = drag.base.clips.find((clip) => clip.id === drag.clipId);
    let trackShift = 0;
    const over = trackAt(event.clientY);
    if (dragged && over && over.kind === clipTrackKind(dragged)) {
      const ordered = tracksOfKind(drag.base, over.kind);
      trackShift =
        ordered.findIndex((track) => track.id === over.id) -
        ordered.findIndex((track) => track.id === dragged.track_id);
    }
    followDrag(
      drag,
      moveClipsFlush(drag.base, { ids: drag.ids, delta, trackShift, draggedId: drag.clipId }),
    );
  }

  /** A position the edit cannot take leaves the clips at the last one it could. */
  function followDrag(drag: Extract<Drag, { result: EditResult | null }>, result: EditResult) {
    if (result.project) {
      drag.result = result;
      onPreview(result.project);
      setDragError(null);
    } else {
      drag.error = result.error;
      setDragError(result.error);
    }
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    setSnapAt(null);
    setMarquee(null);
    if (!drag || drag.kind === "scrub" || drag.kind === "range" || drag.kind === "marquee") return;
    if (drag.result?.project) onCommit(drag.result.project);
    else if (drag.error) onError(drag.error);
    setDragError(null);
  }

  /** Where a drop at this point lands: the track under it, and a time snapped like a move. */
  function dropPoint(event: ReactDragEvent): { track: Track | undefined; time: number } {
    const time = frame(timeAt(event.clientX));
    const snapped = snapping
      ? snapTo(time, snapTargets(project, engine.currentTime, new Set()), threshold)
      : null;
    return { track: trackAt(event.clientY), time: snapped ?? time };
  }

  function handleDragOver(event: ReactDragEvent) {
    if (!event.dataTransfer.types.includes(SOURCE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const { track, time } = dropPoint(event);
    const next = track ? { trackId: track.id, time } : null;
    if (next?.trackId !== drop?.trackId || next?.time !== drop?.time) setDrop(next);
  }

  function handleDrop(event: ReactDragEvent) {
    setDrop(null);
    const path = event.dataTransfer.getData(SOURCE_DRAG_TYPE);
    if (!path) return;
    event.preventDefault();
    const { track, time } = dropPoint(event);
    if (!track) {
      onError("Drop the file on a track.");
      return;
    }
    onDropSource(path, time, track.id);
  }

  const ruler = useMemo(
    () =>
      rulerTicks(
        pxPerSecond,
        (contentWidth - TIMELINE_ORIGIN_PX) / pxPerSecond,
        project.frame_rate,
      ),
    [pxPerSecond, contentWidth, project.frame_rate],
  );
  const ranged = range !== null && range.end > range.start;
  const firstAudio = project.tracks.findIndex((track) => track.kind === "audio");

  return (
    <div className="video-timeline">
      {dragError && (
        <p className="video-timeline__drag-error" role="status">
          <Icon icon={iconTriangleAlert} /> {dragError}
        </p>
      )}
      <div
        ref={scrollRef}
        className="video-timeline__scroll"
        data-scroll-lock-allow
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={hideBlade}
      >
        <div className="video-timeline__grid" style={{ width: contentWidth + TRACK_HEADER_PX }}>
          <div className="video-timeline__corner">
            <CornerTimecode engine={engine} frameRate={project.frame_rate} />
          </div>
          <div
            className="video-timeline__ruler"
            style={
              {
                width: contentWidth,
                "--minor-tick": `${ruler.minorPx}px`,
              } as CSSProperties
            }
            onPointerDown={handleRulerPointerDown}
            role="slider"
            aria-label="Timeline position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration * 100) / 100}
            aria-valuenow={Math.round(engine.currentTime * 100) / 100}
            aria-valuetext={formatTimecode(engine.currentTime, project.frame_rate)}
            tabIndex={-1}
          >
            {ruler.ticks.map((tick) => (
              <span key={tick} className="video-timeline__tick" style={{ left: at(tick) }}>
                {formatTimecode(tick, project.frame_rate)}
              </span>
            ))}
            {project.markers.map((marker) => (
              <Tooltip
                key={marker.id}
                content={
                  <>
                    {markerLabel(project, marker)}
                    {marker.note && (
                      <span className="video-timeline__marker-note">{marker.note}</span>
                    )}
                  </>
                }
                className="video-timeline__marker-tip"
                style={{ left: at(marker.time) }}
              >
                <button
                  type="button"
                  className="video-timeline__marker"
                  aria-label={`${markerLabel(project, marker)}, ${formatTimecode(marker.time, project.frame_rate)}`}
                  tabIndex={-1}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSeek(marker.time);
                  }}
                />
              </Tooltip>
            ))}
            {range && (
              <span
                className={classNames(
                  "video-timeline__ruler-range",
                  !ranged && "video-timeline__ruler-range--in",
                )}
                style={{
                  left: at(range.start),
                  width: Math.max(0, (range.end - range.start) * pxPerSecond),
                }}
                aria-hidden="true"
              />
            )}
            <div
              ref={playheadHeadRef}
              className="video-timeline__playhead-head"
              aria-hidden="true"
            />
          </div>

          <div className="video-timeline__headers">
            {project.tracks.map((track, index) => (
              <TrackHeader
                key={track.id}
                track={track}
                project={project}
                divided={index === firstAudio && index > 0}
                renaming={renaming === track.id}
                onRenameStart={() => setRenaming(track.id)}
                onRenameEnd={() => setRenaming(null)}
                onTracks={onTracks}
                onError={onError}
              />
            ))}
          </div>

          <div
            ref={lanesRef}
            className={classNames("video-timeline__lanes", `video-timeline__lanes--${tool}`)}
            style={{ width: contentWidth }}
            onPointerDown={handleLanePointerDown}
            onDragOver={handleDragOver}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
            }}
            onDrop={handleDrop}
          >
            {project.tracks.map((track, index) => (
              <div
                key={track.id}
                className={classNames(
                  "video-timeline__lane",
                  `video-timeline__lane--${track.kind}`,
                  index === firstAudio && index > 0 && "video-timeline__lane--divided",
                  track.locked && "video-timeline__lane--locked",
                  track.hidden && "video-timeline__lane--hidden",
                  track.muted && "video-timeline__lane--muted",
                  track.collapsed && "video-timeline__lane--collapsed",
                  drop?.trackId === track.id && "video-timeline__lane--drop",
                )}
                style={{ height: laneHeight(track) }}
                data-track={track.id}
              >
                {project.clips
                  .filter((clip) => clip.track_id === track.id)
                  .map((clip) => (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      project={project}
                      location={clip.source_id ? sources.get(clip.source_id) : undefined}
                      pxPerSecond={pxPerSecond}
                      levelPx={levelPx}
                      view={view}
                      collapsed={track.collapsed}
                      selected={selection.has(clip.id)}
                      invalid={Boolean(dragError) && selection.has(clip.id)}
                      onPointerDown={(event) => handleClipPointerDown(event, clip)}
                      onTrimPointerDown={(event, edge) => handleTrimPointerDown(event, clip, edge)}
                      onChoose={(additive) => {
                        const ids = new Set(additive ? selection : []);
                        if (additive && ids.has(clip.id)) ids.delete(clip.id);
                        else ids.add(clip.id);
                        onSelect(ids, null);
                      }}
                    />
                  ))}
                {track.kind === "audio" &&
                  crossfadesOn(project, track.id).map(({ id, start, end }) => (
                    <span
                      key={id}
                      className="video-timeline__crossfade"
                      style={{ left: at(start), width: (end - start) * pxPerSecond }}
                      aria-hidden="true"
                    />
                  ))}
                {project.transitions
                  .map((transition) => ({
                    transition,
                    outgoing: project.clips.find((clip) => clip.id === transition.from_clip_id),
                  }))
                  .filter(({ outgoing }) => outgoing?.track_id === track.id)
                  .map(({ transition, outgoing }) => {
                    const overlap = transitionOverlap(project, transition);
                    const start = clipEnd(outgoing as Clip) - overlap;
                    return (
                      <button
                        key={transition.id}
                        type="button"
                        className={classNames(
                          "video-timeline__dissolve",
                          selectedTransition === transition.id &&
                            "video-timeline__dissolve--selected",
                        )}
                        style={{ left: at(start), width: overlap * pxPerSecond }}
                        aria-label={`Cross-dissolve, ${overlap.toFixed(2)} seconds`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          onSelect(new Set(), transition.id);
                        }}
                      />
                    );
                  })}
              </div>
            ))}
            {project.clips.length === 0 && (
              <p className="video-timeline__empty" aria-hidden="true">
                Drag media here from the browser, or press + on a file to add it at the playhead
              </p>
            )}
            {ranged && (
              <div
                className="video-timeline__range"
                style={{
                  left: at(range.start),
                  width: (range.end - range.start) * pxPerSecond,
                }}
                aria-hidden="true"
              />
            )}
            {drop && (
              <div
                className="video-timeline__drop-line"
                style={{
                  top: laneTop(drop.trackId),
                  height: laneHeight(
                    project.tracks.find((track) => track.id === drop.trackId) as Track,
                  ),
                  transform: `translateX(${at(drop.time)}px)`,
                }}
                aria-hidden="true"
              />
            )}
            {project.markers.map((marker) => (
              <div
                key={marker.id}
                className="video-timeline__marker-line"
                style={{ transform: `translateX(${at(marker.time)}px)` }}
                aria-hidden="true"
              />
            ))}
            {marquee && (
              <div className="video-timeline__marquee" style={marquee} aria-hidden="true" />
            )}
            {snapAt !== null && (
              <div
                className="video-timeline__snap"
                style={{ transform: `translateX(${at(snapAt)}px)` }}
                aria-hidden="true"
              />
            )}
            <div ref={bladeRef} className="video-timeline__blade" aria-hidden="true" />
            <div ref={playheadRef} className="video-timeline__playhead" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The playhead's timecode, redrawn on its own so the timeline does not re-render with it. */
function CornerTimecode({ engine, frameRate }: { engine: PreviewEngine; frameRate: number }) {
  const time = usePlayheadTime(engine);
  return <span className="video-timeline__timecode">{formatTimecode(time, frameRate)}</span>;
}

const STEPS: [step: number, divisions: number][] = [
  [0.5, 5],
  [1, 4],
  [2, 4],
  [5, 5],
  [10, 5],
  [15, 3],
  [30, 6],
  [60, 4],
  [120, 4],
  [300, 5],
  [600, 6],
];

/** Room for one ``HH:MM:SS:FF`` label and the gap before the next. */
const RULER_LABEL_PX = 96;

/**
 * One label every 0.5 to 600 seconds, whichever leaves room to read it, and minor ticks between
 * them: single frames once they are wide enough to tell apart. A half second rounds down to a
 * whole frame (12 of 25), so every label names a frame.
 */
function rulerTicks(
  pxPerSecond: number,
  seconds: number,
  frameRate: number,
): { ticks: number[]; minorPx: number } {
  const [step, divisions] = STEPS.find(
    ([candidate]) => candidate * pxPerSecond >= RULER_LABEL_PX,
  ) ?? [600, 6];
  const half = Math.max(1, Math.floor(Math.round(frameRate) / 2)) / frameRate;
  const ticks: number[] = [];
  for (let time = 0; time <= seconds; time += Math.max(1, step)) {
    ticks.push(time);
    if (step < 1 && time + half <= seconds) ticks.push(time + half);
  }
  const framePx = pxPerSecond / frameRate;
  return { ticks, minorPx: framePx >= FRAME_TICK_PX ? framePx : (step * pxPerSecond) / divisions };
}

interface TrackHeaderProps {
  track: Track;
  project: Project;
  /** The first audio track draws the line between picture and sound. */
  divided: boolean;
  renaming: boolean;
  onRenameStart: () => void;
  onRenameEnd: () => void;
  onTracks: (next: Project) => void;
  onError: (message: string) => void;
}

function TrackHeader({
  track,
  project,
  divided,
  renaming,
  onRenameStart,
  onRenameEnd,
  onTracks,
  onError,
}: TrackHeaderProps) {
  const [draft, setDraft] = useState(track.name);
  const empty = !project.clips.some((clip) => clip.track_id === track.id);
  const apply = (result: EditResult) => {
    if (result.project) onTracks(result.project);
    else onError(result.error);
  };
  const update = (patch: Partial<Track>) => apply(updateTrack(project, track.id, patch));
  const swap = (direction: -1 | 1) => apply(moveTrack(project, track.id, direction));
  const remove = () => apply(removeTrack(project, track.id));

  return (
    <div
      className={classNames(
        "video-timeline__header",
        `video-timeline__header--${track.kind}`,
        divided && "video-timeline__header--divided",
        track.locked && "video-timeline__header--locked",
        track.collapsed && "video-timeline__header--collapsed",
      )}
      style={{ height: laneHeight(track) }}
    >
      <div className="video-timeline__header-row">
        <ToolButton
          icon={track.collapsed ? iconChevronRight : iconChevronDown}
          label={track.collapsed ? `Expand ${track.name}` : `Collapse ${track.name}`}
          tooltip={
            track.collapsed
              ? `Expand ${track.name} to show its pictures and sound`
              : `Collapse ${track.name} to a row of clip names`
          }
          className="video-timeline__fold"
          onClick={() => update({ collapsed: !track.collapsed })}
        />
        {renaming ? (
          <input
            className="video-timeline__name-input"
            value={draft}
            maxLength={40}
            aria-label={`Name of ${track.name}`}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft.trim()) update({ name: draft.trim() });
              onRenameEnd();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(track.name);
                onRenameEnd();
              }
            }}
          />
        ) : (
          <Tooltip content="Double-click to rename" className="video-timeline__name-tip">
            <button
              type="button"
              className="video-timeline__name"
              onDoubleClick={() => {
                setDraft(track.name);
                onRenameStart();
              }}
              aria-label={`${track.name}, double-click to rename`}
            >
              {track.name}
            </button>
          </Tooltip>
        )}
        <div className="video-timeline__header-manage">
          <ToolButton
            icon={iconChevronUp}
            label={`Move ${track.name} up`}
            onClick={() => swap(-1)}
          />
          <ToolButton
            icon={iconChevronDown}
            label={`Move ${track.name} down`}
            onClick={() => swap(1)}
          />
          <ToolButton
            icon={iconTrash2}
            label={`Remove ${track.name}`}
            tooltip={empty ? `Remove ${track.name}` : "Only an empty track can be removed"}
            disabled={!empty}
            onClick={remove}
          />
        </div>
      </div>
      <div className="video-timeline__header-toggles">
        {track.kind === "video" ? (
          <ToolButton
            icon={track.hidden ? iconEyeOff : iconEye}
            label={track.hidden ? `Show ${track.name}` : `Hide ${track.name}`}
            pressed={track.hidden}
            className="video-timeline__toggle video-timeline__toggle--hide"
            onClick={() => update({ hidden: !track.hidden })}
          />
        ) : (
          <>
            <ToolButton
              icon={track.muted ? iconVolumeX : iconVolume2}
              label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
              pressed={track.muted}
              className="video-timeline__toggle video-timeline__toggle--mute"
              onClick={() => update({ muted: !track.muted })}
            />
            <ToolButton
              icon={iconHeadphones}
              label={track.solo ? `Stop soloing ${track.name}` : `Solo ${track.name}`}
              pressed={track.solo}
              className="video-timeline__toggle video-timeline__toggle--solo"
              onClick={() => update({ solo: !track.solo })}
            />
          </>
        )}
        <ToolButton
          icon={track.sync_lock ? iconLink2 : iconLink2Off}
          label={
            track.sync_lock
              ? `Turn off sync lock on ${track.name}`
              : `Turn on sync lock on ${track.name}`
          }
          tooltip={
            track.sync_lock
              ? `Sync lock on: ripple delete, insert and ripple trims move ${track.name} too`
              : `Sync lock off: ripple edits elsewhere leave ${track.name} alone`
          }
          pressed={track.sync_lock}
          className="video-timeline__toggle video-timeline__toggle--sync"
          onClick={() => update({ sync_lock: !track.sync_lock })}
        />
        <ToolButton
          icon={track.locked ? iconLock : iconLockOpen}
          label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
          pressed={track.locked}
          className="video-timeline__toggle video-timeline__toggle--lock"
          onClick={() => update({ locked: !track.locked })}
        />
      </div>
    </div>
  );
}

interface TimelineClipProps {
  clip: Clip;
  project: Project;
  location: SourceLocation | undefined;
  pxPerSecond: number;
  /** The zoom the pictures' level of detail follows, settled after a zoom. */
  levelPx: number;
  /** Timeline seconds in view, and a margin either side; pictures are fetched for these. */
  view: TimeRange;
  /** On a collapsed track: the name bar only, so no pictures or waveform are fetched. */
  collapsed: boolean;
  selected: boolean;
  invalid: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
  onTrimPointerDown: (event: ReactPointerEvent, edge: TrimEdge) => void;
  /** Keyboard selection; ``additive`` toggles the clip in the current selection. */
  onChoose: (additive: boolean) => void;
}

function TimelineClip({
  clip,
  project,
  location,
  pxPerSecond,
  levelPx,
  view,
  collapsed,
  selected,
  invalid,
  onPointerDown,
  onTrimPointerDown,
  onChoose,
}: TimelineClipProps) {
  const width = clip.duration * pxPerSecond;
  const source = sourceById(project, clip.source_id);
  const missing = clip.kind !== "title" && (!location || location.missing);
  const label = clipLabel(project, clip);
  return (
    <div
      className={classNames(
        "video-timeline__clip",
        `video-timeline__clip--${clip.kind}`,
        selected && "video-timeline__clip--selected",
        invalid && "video-timeline__clip--invalid",
        missing && "video-timeline__clip--missing",
        width < 28 && "video-timeline__clip--narrow",
      )}
      style={{ left: TIMELINE_ORIGIN_PX + clip.start * pxPerSecond, width }}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onChoose(event.shiftKey);
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${label}, ${formatTimecode(clip.start, project.frame_rate)} to ${formatTimecode(clipEnd(clip), project.frame_rate)}`}
      data-clip={clip.id}
    >
      <span className="video-timeline__clip-head">
        {missing && <Icon icon={iconTriangleAlert} className="video-timeline__clip-icon" />}
        {clip.kind === "title" && <Icon icon={iconType} className="video-timeline__clip-icon" />}
        {clip.link_id && <Icon icon={iconLink} className="video-timeline__clip-icon" />}
        <span className="video-timeline__clip-label">{missing ? `${label} (missing)` : label}</span>
        {clip.speed !== 1 && <span className="video-timeline__clip-speed">{clip.speed}×</span>}
      </span>
      {!collapsed && (
        <span className="video-timeline__clip-body">
          {!missing && location && (
            <ClipPicture
              clip={clip}
              location={location}
              pxPerSecond={pxPerSecond}
              levelPx={levelPx}
              view={view}
              sourceDuration={source?.duration ?? null}
            />
          )}
          {clip.kind === "title" && clip.title && (
            <span className="video-timeline__clip-text">{clip.title.text}</span>
          )}
        </span>
      )}
      {!collapsed && clip.kind === "audio" && clip.keyframes.gain.length > 0 && (
        <GainEnvelope clip={clip} width={width} />
      )}
      {keyframeTimes(clip, ANIMATED_PROPERTIES).map((time) => (
        <span
          key={time}
          className="video-timeline__keyframe"
          style={{ left: (time - clip.start) * pxPerSecond }}
          aria-hidden="true"
        />
      ))}
      {clip.fade_in > 0 && (
        <span
          className="video-timeline__fade video-timeline__fade--in"
          style={{ width: clip.fade_in * pxPerSecond }}
          aria-hidden="true"
        />
      )}
      {clip.fade_out > 0 && (
        <span
          className="video-timeline__fade video-timeline__fade--out"
          style={{ width: clip.fade_out * pxPerSecond }}
          aria-hidden="true"
        />
      )}
      <span
        className="video-timeline__trim video-timeline__trim--start"
        onPointerDown={(event) => onTrimPointerDown(event, "start")}
        aria-hidden="true"
      />
      <span
        className="video-timeline__trim video-timeline__trim--end"
        onPointerDown={(event) => onTrimPointerDown(event, "end")}
        aria-hidden="true"
      />
    </div>
  );
}

const ANIMATED_PROPERTIES: AnimatedProperty[] = ["x", "y", "scale", "rotation", "opacity", "gain"];

/** Pixels between the envelope line's samples; eased segments need more points than keys. */
const ENVELOPE_STEP_PX = 4;

/** The gain envelope as a line over the clip: full height is the top of the gain range, 200%. */
function GainEnvelope({ clip, width }: { clip: Clip; width: number }) {
  const steps = Math.max(2, Math.min(400, Math.ceil(width / ENVELOPE_STEP_PX)));
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const x = (index / steps) * width;
    const gain = clipValueAt(clip, "gain", clip.start + (index / steps) * clip.duration);
    return `${x.toFixed(1)},${(100 - gain * 50).toFixed(1)}`;
  });
  return (
    <svg
      className="video-timeline__envelope"
      viewBox={`0 0 ${Math.max(1, width)} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={points.join(" ")} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A video tile holds this many frames, each about one filmstrip frame wide. */
const FRAMES_PER_TILE = 8;
const FILMSTRIP_LEVEL: TileLevel = {
  tilePx: FRAMES_PER_TILE * FILMSTRIP_FRAME_PX,
  // A frame every 1/32 s at the finest; a closer zoom stretches them.
  minSeconds: FRAMES_PER_TILE / 32,
};
const WAVEFORM_TILE_PX = 512;
const WAVEFORM_LEVEL: TileLevel = { tilePx: WAVEFORM_TILE_PX, minSeconds: 1 / 32 };

/**
 * The take's frames or sound, as tiles of the source in view: a closer zoom asks for finer
 * tiles, so it shows the frames and transients of the stretch it looks at, and the waveform
 * draws a lane per channel.
 */
function ClipPicture({
  clip,
  location,
  pxPerSecond,
  levelPx,
  view,
  sourceDuration,
}: {
  clip: Clip;
  location: SourceLocation;
  pxPerSecond: number;
  levelPx: number;
  view: TimeRange;
  sourceDuration: number | null;
}) {
  if (clip.kind === "video") {
    const tiles = clipTiles(clip, view, pxPerSecond, levelPx, FILMSTRIP_LEVEL, sourceDuration);
    const span = tileSeconds(levelPx, clip.speed, FILMSTRIP_LEVEL);
    return tiles.map((tile) => {
      // The file's last tile is shorter, and holds as many frames as fit its share.
      const count = Math.max(1, Math.round((FRAMES_PER_TILE * (tile.end - tile.start)) / span));
      const url = filmstripUrl(
        location.path,
        tile.start,
        tile.end,
        count,
        FILMSTRIP_HEIGHT,
        location.version,
      );
      return (
        <span
          key={tile.start}
          className="video-timeline__filmstrip"
          style={{
            left: tile.left,
            width: tile.width,
            backgroundImage: `url("${url}")`,
            backgroundSize: "100% 100%",
          }}
          aria-hidden="true"
        />
      );
    });
  }
  if (clip.kind === "image") {
    return (
      <span
        className="video-timeline__filmstrip video-timeline__filmstrip--still"
        style={{ backgroundImage: `url("${thumbnailUrl(location.path, 200, location.version)}")` }}
        aria-hidden="true"
      />
    );
  }
  if (clip.kind === "audio") {
    return (
      <WaveformTiles
        clip={clip}
        location={location}
        tiles={clipTiles(clip, view, pxPerSecond, levelPx, WAVEFORM_LEVEL, sourceDuration)}
        span={tileSeconds(levelPx, clip.speed, WAVEFORM_LEVEL)}
      />
    );
  }
  return null;
}

/**
 * The sound's tiles, each fetched at the device pixels it is drawn at, or a little more, so the
 * browser only ever shrinks the mask: a stretched one blurs the line. A tile is drawn up to √2 of
 * its level's width before the next level takes over, so that is the width asked for.
 */
function WaveformTiles({
  clip,
  location,
  tiles,
  span,
}: {
  clip: Clip;
  location: SourceLocation;
  tiles: MediaTile[];
  span: number;
}) {
  const [drawnPx, setDrawnPx] = useState(0);
  const measure = (element: HTMLSpanElement | null) => {
    const height = element?.clientHeight ?? 0;
    if (height > 0 && height !== drawnPx) setDrawnPx(height);
  };
  const density = Math.min(3, window.devicePixelRatio || 1);
  const height = Math.round(drawnPx * density);
  const fullWidth = Math.ceil(WAVEFORM_TILE_PX * Math.SQRT2 * density);
  return tiles.map((tile, index) => {
    // The file's last tile is shorter, and its picture as much narrower.
    const width = Math.max(1, Math.round((fullWidth * (tile.end - tile.start)) / span));
    const url = waveformUrl(
      location.path,
      tile.start,
      tile.end - tile.start,
      width,
      height,
      location.version,
    );
    return (
      <span
        key={`${clip.id}-${tile.start}`}
        ref={index === 0 ? measure : undefined}
        className="video-timeline__waveform"
        style={{
          left: tile.left,
          width: tile.width,
          // Unmeasured, a mask of a guessed height would be fetched and then thrown away.
          ...(drawnPx > 0
            ? {
                maskImage: `url("${url}")`,
                WebkitMaskImage: `url("${url}")`,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
              }
            : {}),
        }}
        aria-hidden="true"
      />
    );
  });
}

/** Where sound on an audio track overlaps the next clip, and so cross-fades into it. */
function crossfadesOn(project: Project, trackId: string) {
  const ordered = project.clips
    .filter((clip) => clip.track_id === trackId)
    .sort((a, b) => a.start - b.start);
  return ordered.slice(1).flatMap((clip, index) => {
    const end = clipEnd(ordered[index]);
    return end - clip.start > EPSILON ? [{ id: clip.id, start: clip.start, end }] : [];
  });
}
