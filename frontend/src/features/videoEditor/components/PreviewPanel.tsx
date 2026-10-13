import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import {
  iconImage,
  iconLoader2,
  iconPause,
  iconPlay,
  iconPlus,
  iconScanSquare,
  iconSkipBack,
  iconSkipForward,
  iconStepBack,
  iconStepForward,
  iconTriangleAlert,
  iconX,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import {
  ariaKeyShortcuts,
  formatShortcut,
  SHORTCUTS,
  type ShortcutDefinition,
} from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { GalleryItem } from "@/shared/types";
import { AudioWaveform } from "@/features/gallery/components/AudioWaveform";
import { galleryItemMediaUrl, galleryItemWaveformUrl } from "@/features/gallery/lib/thumbnail";
import { isAudioName } from "@/features/gallery/lib/itemKind";
import { useEnginePlaying, usePlayheadTime } from "@/features/videoEditor/hooks/usePlayhead";
import { placement } from "@/features/videoEditor/lib/composition";
import type { PreviewEngine } from "@/features/videoEditor/lib/previewEngine";
import { rangeFill } from "@/features/videoEditor/lib/rangeFill";
import {
  formatTimecode,
  projectDuration,
  snapToFrame,
  type Clip,
  type Project,
} from "@/features/videoEditor/lib/timeline";
import { ToolButton } from "./ToolButton";

export type PreviewMode = "timeline" | "source";

export interface SourceRange {
  start: number;
  end: number | null;
}

/** What the editor's keys do to the source monitor while it is the one showing. */
export interface SourceTransport {
  toggle: () => void;
  step: (frames: number) => void;
  seekToEdge: (edge: "start" | "end") => void;
  markIn: () => void;
  markOut: () => void;
}

interface PreviewPanelProps {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  engine: PreviewEngine;
  project: Project;
  selectedClip: Clip | null;
  onTransform: (clip: Clip, next: Clip["transform"], final: boolean) => void;
  sourceItem: GalleryItem | null;
  sourceRange: SourceRange;
  onSourceRange: (range: SourceRange) => void;
  onAddSource: () => void;
  sourceTransportRef: Ref<SourceTransport | null>;
  hasMissing: boolean;
  guides: boolean;
  onGuides: () => void;
}

export function PreviewPanel({
  mode,
  onModeChange,
  engine,
  project,
  selectedClip,
  onTransform,
  sourceItem,
  sourceRange,
  onSourceRange,
  onAddSource,
  sourceTransportRef,
  hasMissing,
  guides,
  onGuides,
}: PreviewPanelProps) {
  return (
    <section className="video-editor__preview video-editor__pane" aria-label="Preview">
      <div className="video-editor__pane-header">
        <div className="video-editor__segmented" role="tablist" aria-label="Preview source">
          {(["source", "timeline"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={classNames(
                "video-editor__segment",
                mode === value && "video-editor__segment--on",
              )}
              disabled={value === "source" && !sourceItem}
              onClick={() => onModeChange(value)}
            >
              {value === "source" ? "Source" : "Timeline"}
            </button>
          ))}
        </div>
        <span className="video-editor__pane-caption">
          {mode === "source" ? (sourceItem?.name ?? "Pick a file in Media") : project.name}
        </span>
        {mode === "timeline" && (
          <ToolButton
            icon={iconScanSquare}
            label="Safe-area guides"
            tooltip={guides ? "Hide the safe-area guides" : "Show the safe-area guides"}
            pressed={guides}
            onClick={onGuides}
          />
        )}
      </div>
      {mode === "timeline" ? (
        <TimelinePreview
          engine={engine}
          project={project}
          selectedClip={selectedClip}
          onTransform={onTransform}
          hasMissing={hasMissing}
          guides={guides}
        />
      ) : sourceItem ? (
        <SourcePreview
          key={sourceItem.path}
          item={sourceItem}
          range={sourceRange}
          onRange={onSourceRange}
          onAdd={onAddSource}
          frameRate={project.frame_rate}
          transportRef={sourceTransportRef}
        />
      ) : null}
    </section>
  );
}

function TimelinePreview({
  engine,
  project,
  selectedClip,
  onTransform,
  hasMissing,
  guides,
}: {
  engine: PreviewEngine;
  project: Project;
  selectedClip: Clip | null;
  onTransform: (clip: Clip, next: Clip["transform"], final: boolean) => void;
  hasMissing: boolean;
  guides: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const time = usePlayheadTime(engine);
  const { playing, waiting } = useEnginePlaying(engine);
  const duration = projectDuration(project);
  const step = 1 / project.frame_rate;
  // The scrubber counts frames: a seconds range stepped by 1/fps stops on its last whole step,
  // short of an end that is off the frame grid. Its last slot always means the very end.
  const lastFrame = Math.max(1, Math.ceil(duration * project.frame_rate - 1e-6));
  const frameValue = time >= duration - 1e-6 ? lastFrame : Math.round(time * project.frame_rate);

  // The canvas keeps the project's shape inside whatever room the panel has.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      const ratio = project.width / project.height;
      const fitted =
        width / height > ratio
          ? { width: height * ratio, height }
          : { width, height: width / ratio };
      setBox({
        width: Math.max(1, Math.floor(fitted.width)),
        height: Math.max(1, Math.floor(fitted.height)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [project.width, project.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.min(project.width, Math.round(box.width * density));
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, Math.round((width * project.height) / project.width));
    engine.attach(canvas);
    return () => engine.attach(null);
  }, [engine, box.width, project.width, project.height]);

  return (
    <>
      <div ref={stageRef} className="video-editor__stage">
        <div className="video-editor__canvas-box" style={{ width: box.width, height: box.height }}>
          <canvas ref={canvasRef} className="video-editor__canvas" aria-label="Timeline preview" />
          {guides && (
            <span className="video-editor__guides" aria-hidden="true">
              <span className="video-editor__guide video-editor__guide--action" />
              <span className="video-editor__guide video-editor__guide--title" />
              <span className="video-editor__guide-cross" />
            </span>
          )}
          {selectedClip && selectedClip.kind !== "audio" && (
            <TransformHandles
              clip={selectedClip}
              project={project}
              scale={box.width / project.width}
              onTransform={onTransform}
            />
          )}
          {duration <= 0 && (
            <span className="video-editor__stage-empty">
              Add media to the timeline to see it here
            </span>
          )}
          {waiting && (
            <span className="video-editor__stage-note" role="status">
              <Icon icon={iconLoader2} spin /> Preparing media...
            </span>
          )}
          {hasMissing && !waiting && (
            <span
              className="video-editor__stage-note video-editor__stage-note--warning"
              role="status"
            >
              <Icon icon={iconTriangleAlert} /> Some media is missing; it shows as a marked box.
            </span>
          )}
        </div>
      </div>
      <div className="video-editor__monitor-controls">
        <input
          type="range"
          className="video-editor__scrubber"
          min={0}
          max={lastFrame}
          step={1}
          value={frameValue}
          style={rangeFill(duration > 0 ? frameValue : 0, 0, lastFrame)}
          disabled={duration <= 0}
          aria-label="Playhead"
          aria-valuetext={formatTimecode(time, project.frame_rate)}
          onChange={(event) => engine.seek(Number(event.target.value) / project.frame_rate)}
        />
        <div className="video-editor__transport">
          <span className="video-editor__timecode video-editor__timecode--current" aria-live="off">
            {formatTimecode(time, project.frame_rate)}
          </span>
          <div className="video-editor__transport-buttons">
            <ToolButton
              icon={iconSkipBack}
              label="Go to the start"
              shortcut={SHORTCUTS.editorGoToStart}
              onClick={() => engine.seek(0)}
            />
            <ToolButton
              icon={iconStepBack}
              label="Previous frame"
              shortcut={SHORTCUTS.editorStepBack}
              onClick={() =>
                engine.seek(snapToFrame(engine.currentTime - step, project.frame_rate))
              }
            />
            <ToolButton
              icon={playing ? iconPause : iconPlay}
              label={playing ? "Pause" : "Play"}
              shortcut={SHORTCUTS.editorPlayPause}
              className="video-editor__play"
              onClick={() => engine.toggle()}
              disabled={duration <= 0}
            />
            <ToolButton
              icon={iconStepForward}
              label="Next frame"
              shortcut={SHORTCUTS.editorStepForward}
              onClick={() =>
                engine.seek(snapToFrame(engine.currentTime + step, project.frame_rate))
              }
            />
            <ToolButton
              icon={iconSkipForward}
              label="Go to the end"
              shortcut={SHORTCUTS.editorGoToEnd}
              onClick={() => engine.seek(duration)}
            />
          </div>
          <span className="video-editor__timecode video-editor__timecode--total">
            {formatTimecode(duration, project.frame_rate)}
          </span>
        </div>
      </div>
    </>
  );
}

/** Drag the box to move the clip and a corner to scale it, in the preview's own pixels. */
function TransformHandles({
  clip,
  project,
  scale,
  onTransform,
}: {
  clip: Clip;
  project: Project;
  scale: number;
  onTransform: (clip: Clip, next: Clip["transform"], final: boolean) => void;
}) {
  const dragRef = useRef<{
    kind: "move" | "scale";
    x: number;
    y: number;
    start: Clip["transform"];
    centerX: number;
    centerY: number;
  } | null>(null);
  if (clip.kind === "title") return null;
  const place = placement(project, clip);
  const width = place.width * scale;
  const height = place.height * scale;

  const begin = (event: ReactPointerEvent, kind: "move" | "scale") => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const parent = event.currentTarget
      .closest(".video-editor__canvas-box")
      ?.getBoundingClientRect();
    dragRef.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      start: clip.transform,
      centerX: (parent?.left ?? 0) + place.centerX * scale,
      centerY: (parent?.top ?? 0) + place.centerY * scale,
    };
  };
  const next = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return null;
    if (drag.kind === "move") {
      return {
        ...drag.start,
        x: clamp(drag.start.x + (event.clientX - drag.x) / scale / project.width, -2, 2),
        y: clamp(drag.start.y + (event.clientY - drag.y) / scale / project.height, -2, 2),
      };
    }
    const before = Math.hypot(drag.x - drag.centerX, drag.y - drag.centerY);
    const after = Math.hypot(event.clientX - drag.centerX, event.clientY - drag.centerY);
    return {
      ...drag.start,
      scale: clamp(drag.start.scale * (after / Math.max(before, 1)), 0.05, 8),
    };
  };

  return (
    <div
      className="video-editor__handles"
      style={{
        left: place.centerX * scale - width / 2,
        top: place.centerY * scale - height / 2,
        width,
        height,
        transform: `rotate(${place.rotation}deg)`,
      }}
      onPointerDown={(event) => begin(event, "move")}
      onPointerMove={(event) => {
        const transform = next(event);
        if (transform) onTransform(clip, transform, false);
      }}
      onPointerUp={(event) => {
        const transform = next(event);
        dragRef.current = null;
        if (transform) onTransform(clip, transform, true);
      }}
      aria-label="Move the selected clip in the frame"
      role="presentation"
    >
      {(["nw", "ne", "sw", "se"] as const).map((corner) => (
        <span
          key={corner}
          className={`video-editor__handle video-editor__handle--${corner}`}
          onPointerDown={(event) => begin(event, "scale")}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** One file played on its own, with in and out points marked on its scrubber. */
function SourcePreview({
  item,
  range,
  onRange,
  onAdd,
  frameRate,
  transportRef,
}: {
  item: GalleryItem;
  range: SourceRange;
  onRange: (range: SourceRange) => void;
  onAdd: () => void;
  frameRate: number;
  transportRef: Ref<SourceTransport | null>;
}) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const url = galleryItemMediaUrl(item);
  const audio = isAudioName(item.name);
  const timed = item.media_type === "video" || audio;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaDuration, setMediaDuration] = useState<number | null>(item.duration ?? null);
  const duration = mediaDuration ?? 0;
  const end = range.end ?? (mediaDuration || null);
  const lastFrame = Math.max(1, Math.ceil(duration * frameRate - 1e-6));
  const frameValue = Math.min(lastFrame, Math.round(time * frameRate));

  // Reads the clock every frame while playing, so the scrubber moves smoothly, not at 4 Hz.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setTime(mediaRef.current?.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seek = useCallback(
    (seconds: number) => {
      const media = mediaRef.current;
      if (!media) return;
      const next = Math.min(Math.max(0, seconds), media.duration || duration || 0);
      media.currentTime = next;
      setTime(next);
    },
    [duration],
  );
  const current = useCallback(
    () => snapToFrame(mediaRef.current?.currentTime ?? 0, frameRate),
    [frameRate],
  );
  const toggle = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  }, []);
  const markIn = useCallback(() => {
    const at = current();
    onRange({ start: at, end: range.end !== null && range.end > at ? range.end : null });
  }, [current, onRange, range.end]);
  const markOut = useCallback(() => {
    const at = current();
    onRange({ start: range.start < at ? range.start : 0, end: at });
  }, [current, onRange, range.start]);

  useImperativeHandle<SourceTransport | null, SourceTransport | null>(
    transportRef,
    () =>
      timed
        ? {
            toggle,
            step: (frames: number) => {
              mediaRef.current?.pause();
              seek(snapToFrame(current() + frames / frameRate, frameRate));
            },
            seekToEdge: (edge: "start" | "end") => seek(edge === "start" ? 0 : duration),
            markIn,
            markOut,
          }
        : null,
    [current, duration, frameRate, markIn, markOut, seek, timed, toggle],
  );

  const mediaEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => {
      setPlaying(false);
      setTime(mediaRef.current?.currentTime ?? 0);
    },
    onEnded: () => setPlaying(false),
    onSeeked: () => setTime(mediaRef.current?.currentTime ?? 0),
    onTimeUpdate: () => {
      if (!playing) setTime(mediaRef.current?.currentTime ?? 0);
    },
    onLoadedMetadata: () => {
      const seconds = mediaRef.current?.duration;
      if (seconds && Number.isFinite(seconds)) setMediaDuration(seconds);
    },
  };
  const percent = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0);
  const marked = range.start > 0 || range.end !== null;

  return (
    <>
      <div className="video-editor__stage">
        {item.media_type === "video" ? (
          <video
            ref={mediaRef}
            className="video-editor__source"
            src={url}
            preload="auto"
            onClick={toggle}
            {...mediaEvents}
          />
        ) : audio ? (
          <div className="video-editor__source-audio">
            <AudioWaveform
              src={galleryItemWaveformUrl(item)}
              className="video-editor__source-waveform"
            />
            <span
              className="video-editor__source-audio-head"
              style={{ left: `${percent(time)}%` }}
              aria-hidden="true"
            />
            <audio ref={mediaRef} src={url} preload="auto" {...mediaEvents} />
          </div>
        ) : (
          <img className="video-editor__source" src={url} alt={item.name} />
        )}
      </div>
      <div className="video-editor__monitor-controls">
        {timed && (
          <div className="video-editor__source-scrub">
            {duration > 0 && marked && (
              <span
                className="video-editor__source-range"
                style={{
                  left: `${percent(range.start)}%`,
                  width: `${percent((end ?? duration) - range.start)}%`,
                }}
                aria-hidden="true"
              />
            )}
            <input
              type="range"
              className="video-editor__scrubber"
              min={0}
              max={lastFrame}
              step={1}
              value={frameValue}
              style={rangeFill(frameValue, 0, lastFrame)}
              aria-label="Source position"
              aria-valuetext={formatTimecode(time, frameRate)}
              onChange={(event) => seek(Number(event.target.value) / frameRate)}
            />
          </div>
        )}
        <div className="video-editor__transport">
          {timed ? (
            <span className="video-editor__timecode video-editor__timecode--current">
              {formatTimecode(time, frameRate)}
            </span>
          ) : (
            <span className="video-editor__source-still">
              <Icon icon={iconImage} /> Still image
            </span>
          )}
          {timed && (
            <div className="video-editor__transport-buttons">
              <ToolButton
                icon={iconStepBack}
                label="Previous frame"
                shortcut={SHORTCUTS.editorStepBack}
                onClick={() => {
                  mediaRef.current?.pause();
                  seek(snapToFrame(current() - 1 / frameRate, frameRate));
                }}
              />
              <ToolButton
                icon={playing ? iconPause : iconPlay}
                label={playing ? "Pause source" : "Play source"}
                shortcut={SHORTCUTS.editorPlayPause}
                className="video-editor__play"
                onClick={toggle}
              />
              <ToolButton
                icon={iconStepForward}
                label="Next frame"
                shortcut={SHORTCUTS.editorStepForward}
                onClick={() => {
                  mediaRef.current?.pause();
                  seek(snapToFrame(current() + 1 / frameRate, frameRate));
                }}
              />
              <span className="video-editor__transport-gap" aria-hidden="true" />
              <MarkButton label="Mark in" shortcut={SHORTCUTS.editorMarkIn} onClick={markIn} />
              <MarkButton label="Mark out" shortcut={SHORTCUTS.editorMarkOut} onClick={markOut} />
            </div>
          )}
          <div className="video-editor__source-actions">
            {timed && (
              <span className="video-editor__source-marks">
                <span>
                  In <b>{formatTimecode(range.start, frameRate)}</b>
                </span>
                <span>
                  Out <b>{end === null ? "end" : formatTimecode(end, frameRate)}</b>
                </span>
                {marked && (
                  <button
                    type="button"
                    className="video-editor__icon-btn"
                    aria-label="Clear in and out"
                    title="Clear in and out"
                    onClick={() => onRange({ start: 0, end: null })}
                  >
                    <Icon icon={iconX} />
                  </button>
                )}
              </span>
            )}
            <button
              type="button"
              className="video-editor__primary-btn"
              onClick={onAdd}
              title="Places it at the timeline playhead"
            >
              <Icon icon={iconPlus} /> Add to timeline
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** "In" and "Out" read better than any icon; the tooltip names the key. */
function MarkButton({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut: ShortcutDefinition;
  onClick: () => void;
}) {
  return (
    <Tooltip content={`${label} at this frame (${formatShortcut(shortcut)})`} placement="top">
      <button
        type="button"
        className="video-editor__mark"
        aria-label={label}
        aria-keyshortcuts={ariaKeyShortcuts(shortcut)}
        onClick={onClick}
      >
        {label === "Mark in" ? "In" : "Out"}
      </button>
    </Tooltip>
  );
}
