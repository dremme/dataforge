import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { formatApiError } from "@/shared/api/http";
import {
  iconImage,
  iconImageDown,
  iconInsert,
  iconLoader2,
  iconPause,
  iconPlay,
  iconPlus,
  iconReplace,
  iconScanSquare,
  iconSkipBack,
  iconSkipForward,
  iconStepBack,
  iconStepForward,
  iconTriangleAlert,
  iconX,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { ariaKeyShortcuts, SHORTCUTS, type ShortcutDefinition } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutHint } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { GalleryItem } from "@/shared/types";
import { AudioWaveform } from "@/features/gallery/components/AudioWaveform";
import { galleryItemMediaUrl, galleryItemWaveformUrl } from "@/features/gallery/lib/thumbnail";
import { isAudioName } from "@/features/gallery/lib/itemKind";
import {
  useEnginePlaying,
  usePlayheadTime,
  usePreviewFidelity,
} from "@/features/videoEditor/hooks/usePlayhead";
import { placement } from "@/features/videoEditor/lib/composition";
import { MAX_ADJUST_WIDTH, type PreviewEngine } from "@/features/videoEditor/lib/previewEngine";
import { rangeFill } from "@/features/videoEditor/lib/rangeFill";
import {
  formatTimecode,
  projectDuration,
  snapToFrame,
  type Clip,
  type Project,
} from "@/features/videoEditor/lib/timeline";
import type { ReplacePolicy } from "@/features/videoEditor/lib/assembly";
import { MixMeter } from "./MixMeter";
import { RenderedFrame, type RenderedFrameState } from "./RenderedFrame";
import { TimecodeField } from "./TimecodeField";
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
  /** Places the marked range at the playhead and moves everything after it later. */
  onInsertSource: () => void;
  /** Puts the marked range in place of the selected clip. */
  onReplaceSource: (policy: ReplacePolicy) => void;
  /** The clip a replacement would take the place of; null when none can be replaced. */
  replaceLabel: string | null;
  sourceTransportRef: Ref<SourceTransport | null>;
  hasMissing: boolean;
  guides: boolean;
  onGuides: () => void;
  /** The export renderer's picture of the frame at ``time``, at the project's full size. */
  renderFrame: (time: number) => Promise<Blob>;
  /** Shown above the timeline monitor, e.g. sources the browser cannot play. */
  notice?: ReactNode;
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
  onInsertSource,
  onReplaceSource,
  replaceLabel,
  sourceTransportRef,
  hasMissing,
  guides,
  onGuides,
  renderFrame,
  notice,
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
      {mode === "timeline" && notice}
      {mode === "timeline" ? (
        <TimelinePreview
          engine={engine}
          project={project}
          selectedClip={selectedClip}
          onTransform={onTransform}
          hasMissing={hasMissing}
          guides={guides}
          renderFrame={renderFrame}
        />
      ) : sourceItem ? (
        <SourcePreview
          key={sourceItem.path}
          item={sourceItem}
          range={sourceRange}
          onRange={onSourceRange}
          onAdd={onAddSource}
          onInsert={onInsertSource}
          onReplace={onReplaceSource}
          replaceLabel={replaceLabel}
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
  renderFrame,
}: {
  engine: PreviewEngine;
  project: Project;
  selectedClip: Clip | null;
  onTransform: (clip: Clip, next: Clip["transform"], final: boolean) => void;
  hasMissing: boolean;
  guides: boolean;
  renderFrame: (time: number) => Promise<Blob>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [drawn, setDrawn] = useState({ width: 0, height: 0 });
  const time = usePlayheadTime(engine);
  const { playing, waiting } = useEnginePlaying(engine);
  const fidelity = usePreviewFidelity(engine);
  const [frame, setFrame] = useState<RenderedFrameState | null>(null);
  const [frameState, setFrameState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
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
    setDrawn({ width: canvas.width, height: canvas.height });
    engine.attach(canvas);
    return () => engine.attach(null);
  }, [engine, box.width, project.width, project.height]);

  // A rendered frame answers for one moment of one edit; moving on puts the live preview back.
  useEffect(() => setFrame(null), [time, project]);
  useEffect(() => {
    if (!frame) return;
    return () => URL.revokeObjectURL(frame.url);
  }, [frame]);

  const showRenderedFrame = async () => {
    engine.pause();
    const at = engine.currentTime;
    setFrameState({ busy: true, error: null });
    try {
      const blob = await renderFrame(at);
      setFrame({
        url: URL.createObjectURL(blob),
        timecode: formatTimecode(at, project.frame_rate),
        width: project.width,
        height: project.height,
      });
      setFrameState({ busy: false, error: null });
    } catch (error) {
      setFrameState({ busy: false, error: formatApiError(error) });
    }
  };
  const reduced = drawn.width > 0 && drawn.width < project.width;
  const sizeNote = [
    `The monitor draws ${drawn.width} × ${drawn.height} of the ${project.width} × ` +
      `${project.height} canvas.`,
    fidelity.adjustReduced &&
      `Color-adjusted clips are drawn from a copy at most ${MAX_ADJUST_WIDTH} px wide.`,
    "Show the export's frame to inspect it at full size.",
  ]
    .filter(Boolean)
    .join(" ");
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
          {frame && <RenderedFrame frame={frame} onClose={() => setFrame(null)} />}
          {waiting ? (
            <span className="video-editor__stage-note" role="status">
              <Icon icon={iconLoader2} spin /> Preparing media...
            </span>
          ) : frameState.busy ? (
            <span className="video-editor__stage-note" role="status">
              <Icon icon={iconLoader2} spin /> Rendering the export's frame...
            </span>
          ) : frameState.error ? (
            <span
              className="video-editor__stage-note video-editor__stage-note--warning"
              role="alert"
            >
              <Icon icon={iconTriangleAlert} /> {frameState.error}
            </span>
          ) : hasMissing ? (
            <span
              className="video-editor__stage-note video-editor__stage-note--warning"
              role="status"
            >
              <Icon icon={iconTriangleAlert} /> Some media is missing; it shows as a marked box.
            </span>
          ) : (
            fidelity.adjustUnavailable &&
            !frame && (
              <span
                className="video-editor__stage-note video-editor__stage-note--warning"
                role="status"
              >
                <Icon icon={iconTriangleAlert} /> Color adjustments cannot be drawn here, so
                adjusted clips show their original colors. The export applies them.
              </span>
            )
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
          <TimecodeField
            label="Playhead time"
            className="video-editor__timecode video-editor__timecode--current"
            value={time}
            frameRate={project.frame_rate}
            onCommit={(seconds) => engine.seek(seconds)}
          />
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
          <div className="video-editor__transport-end">
            <MixMeter engine={engine} />
            {drawn.width > 0 && (
              <span
                className={classNames(
                  "video-editor__preview-size",
                  (reduced || fidelity.adjustReduced) && "video-editor__preview-size--reduced",
                )}
                title={sizeNote}
              >
                {drawn.width} × {drawn.height}
                {fidelity.adjustReduced && ` · color ${MAX_ADJUST_WIDTH} px`}
              </span>
            )}
            <ToolButton
              icon={iconImageDown}
              label="Show the export's frame"
              tooltip="Render this frame as the export will, at full size"
              onClick={() => void showRenderedFrame()}
              disabled={duration <= 0 || frameState.busy}
            />
            <span className="video-editor__timecode video-editor__timecode--total">
              {formatTimecode(duration, project.frame_rate)}
            </span>
          </div>
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
  onInsert,
  onReplace,
  replaceLabel,
  frameRate,
  transportRef,
}: {
  item: GalleryItem;
  range: SourceRange;
  onRange: (range: SourceRange) => void;
  onAdd: () => void;
  onInsert: () => void;
  onReplace: (policy: ReplacePolicy) => void;
  replaceLabel: string | null;
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
        </div>
        <div className="video-editor__source-bar">
          {timed && (
            <span className="video-editor__source-marks">
              <span>
                In <b>{formatTimecode(range.start, frameRate)}</b>
              </span>
              <span>
                Out <b>{end === null ? "end" : formatTimecode(end, frameRate)}</b>
              </span>
              {marked && (
                <Tooltip content="Clear in and out, to use the whole file" placement="top">
                  <button
                    type="button"
                    className="video-editor__icon-btn"
                    aria-label="Clear in and out"
                    onClick={() => onRange({ start: 0, end: null })}
                  >
                    <Icon icon={iconX} />
                  </button>
                </Tooltip>
              )}
            </span>
          )}
          <div className="video-editor__source-actions">
            {replaceLabel && (
              <>
                <SourceAction
                  tip={`Put this take in place of ${replaceLabel}. Its start, link, look and dissolves stay; a shorter take ends the clip early and leaves a gap.`}
                  onClick={() => onReplace("keep-speed")}
                >
                  <Icon icon={iconReplace} /> Replace
                </SourceAction>
                <SourceAction
                  tip={`Retime the marked range so it fills ${replaceLabel} exactly, between 0.25× and 4× speed.`}
                  onClick={() => onReplace("fit-to-fill")}
                >
                  Fit to fill
                </SourceAction>
              </>
            )}
            <SourceAction
              tip="Place it at the playhead and move everything after it later, on every track."
              onClick={onInsert}
            >
              <Icon icon={iconInsert} /> Insert
            </SourceAction>
            <SourceAction
              tip="Place it at the playhead on the first free track; nothing else moves."
              primary
              onClick={onAdd}
            >
              <Icon icon={iconPlus} /> Add to timeline
            </SourceAction>
          </div>
        </div>
      </div>
    </>
  );
}

/** One way to put the source on the timeline, explained by its tooltip. */
function SourceAction({
  tip,
  primary = false,
  onClick,
  children,
}: {
  tip: string;
  primary?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tip} placement="top" bubbleClassName="video-editor__source-tip">
      <button
        type="button"
        className={primary ? "video-editor__primary-btn" : "video-editor__secondary-btn"}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
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
    <Tooltip
      content={<ShortcutHint shortcut={shortcut}>{label} at this frame</ShortcutHint>}
      placement="top"
    >
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
