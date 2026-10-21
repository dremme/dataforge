import { Tooltip } from "@/shared/ui/Tooltip";
import { Fragment, useId } from "react";
import {
  iconBlend,
  iconClipboardPaste,
  iconFilm,
  iconImage,
  iconLink,
  iconLoader2,
  iconMusic,
  iconTrash2,
  iconType,
  iconUnlink,
  iconWandSparkles,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { SHORTCUTS, type ShortcutDefinition } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutKeys } from "@/shared/ui/ShortcutKeys";
import { AUTO_ADJUST_DEFAULT_AMOUNT } from "@/shared/constants";
import type { ColorAdjust, VideoProjectFadeCurve, VideoProjectTitleAlign } from "@/shared/types";
import {
  adjustRange,
  formatAdjustValue,
  isAdjustIdentity,
  type AdjustTool,
} from "@/features/gallery/lib/colorAdjust";
import { rescaleAuto, withoutAuto } from "@/features/gallery/lib/autoAdjust";
import { SPEED_PRESETS } from "@/features/gallery/lib/videoEdit";
import {
  clipEnd,
  clipLabel,
  findTransition,
  formatTimecode,
  MIN_CLIP_SECONDS,
  nextNeighbour,
  projectDuration,
  restingAdjust,
  sourceById,
  transitionOverlap,
  type Clip,
  type EditResult,
  type Project,
} from "@/features/videoEditor/lib/timeline";
import { formatClockSeconds } from "@/features/videoEditor/lib/timecode";

import { TRANSFORM_PROPERTIES } from "@/features/videoEditor/lib/keyframes";
import { FontPicker } from "./FontPicker";
import { GradePresets } from "./GradePresets";
import {
  InspectorHeader,
  Panel,
  ResetButton,
  SectionMemory,
  Slider,
  type ClipEdit,
} from "./InspectorParts";
import { KeyedSlider, KeyframeBar } from "./KeyframeControls";
import { MarkersPanel } from "./MarkersPanel";
import { MixPanel, type MixEdit, type TrackEdit } from "./MixPanel";
import { MultiClipInspector, type BatchEdit } from "./MultiClipInspector";
import { SoundPanel } from "./SoundPanel";
import { TimecodeField } from "./TimecodeField";

const COLOR_GROUPS: { label: string; tools: { id: AdjustTool; label: string }[] }[] = [
  {
    label: "Light",
    tools: [
      { id: "exposure", label: "Exposure" },
      { id: "brilliance", label: "Brilliance" },
      { id: "highlights", label: "Highlights" },
      { id: "shadows", label: "Shadows" },
      { id: "contrast", label: "Contrast" },
      { id: "brightness", label: "Brightness" },
      { id: "black_point", label: "Black Point" },
      { id: "white_point", label: "White Point" },
    ],
  },
  {
    label: "Color",
    tools: [
      { id: "saturation", label: "Saturation" },
      { id: "vibrance", label: "Vibrance" },
      { id: "warmth", label: "Warmth" },
      { id: "tint", label: "Tint" },
      { id: "hue", label: "Hue" },
    ],
  },
  {
    label: "Detail",
    tools: [
      { id: "definition", label: "Definition" },
      { id: "noise_reduction", label: "Noise Reduction" },
    ],
  },
];

const RESTING_TRANSFORM: Clip["transform"] = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

const KIND_ICONS: Record<Clip["kind"], typeof iconFilm> = {
  video: iconFilm,
  image: iconImage,
  audio: iconMusic,
  title: iconType,
};

/** Every video editor shortcut, which the `?` sheet leaves out; mirrored actions share a row. */
const QUICK_KEYS: { label: string; shortcuts: ShortcutDefinition[] }[] = [
  { label: "Play or pause", shortcuts: [SHORTCUTS.editorPlayPause] },
  {
    label: "Step a frame back, forward",
    shortcuts: [SHORTCUTS.editorStepBack, SHORTCUTS.editorStepForward],
  },
  { label: "Go to start, end", shortcuts: [SHORTCUTS.editorGoToStart, SHORTCUTS.editorGoToEnd] },
  {
    label: "Previous, next edit",
    shortcuts: [SHORTCUTS.editorPreviousEdit, SHORTCUTS.editorNextEdit],
  },
  {
    label: "Previous, next marker",
    shortcuts: [SHORTCUTS.editorPreviousMarker, SHORTCUTS.editorNextMarker],
  },
  { label: "Add a marker", shortcuts: [SHORTCUTS.editorAddMarker] },
  { label: "Mark in, out", shortcuts: [SHORTCUTS.editorMarkIn, SHORTCUTS.editorMarkOut] },
  { label: "Clear selection and range", shortcuts: [SHORTCUTS.editorClearMarks] },
  {
    label: "Select, Blade, Range",
    shortcuts: [SHORTCUTS.editorSelectTool, SHORTCUTS.editorBladeTool, SHORTCUTS.editorRangeTool],
  },
  {
    label: "Ripple, roll trim tool",
    shortcuts: [SHORTCUTS.editorRippleTool, SHORTCUTS.editorRollTool],
  },
  { label: "Toggle snapping", shortcuts: [SHORTCUTS.editorSnapping] },
  {
    label: "Zoom in, out, fit",
    shortcuts: [SHORTCUTS.editorZoomIn, SHORTCUTS.editorZoomOut, SHORTCUTS.editorZoomFit],
  },
  { label: "Split at the playhead", shortcuts: [SHORTCUTS.editorSplit] },
  { label: "Delete clips", shortcuts: [SHORTCUTS.editorDelete] },
  { label: "Ripple delete the range", shortcuts: [SHORTCUTS.editorRippleDelete] },
  { label: "Duplicate clips", shortcuts: [SHORTCUTS.editorDuplicate] },
  {
    label: "Nudge a frame earlier, later",
    shortcuts: [SHORTCUTS.editorNudgeBack, SHORTCUTS.editorNudgeForward],
  },
  {
    label: "Trim start, end to the playhead",
    shortcuts: [SHORTCUTS.editorTrimStart, SHORTCUTS.editorTrimEnd],
  },
  {
    label: "Ripple trim start, end",
    shortcuts: [SHORTCUTS.editorRippleTrimStart, SHORTCUTS.editorRippleTrimEnd],
  },
  { label: "Select every clip", shortcuts: [SHORTCUTS.editorSelectAll] },
  { label: "Select from the playhead on", shortcuts: [SHORTCUTS.editorSelectForward] },
  { label: "Same, on the selected tracks", shortcuts: [SHORTCUTS.editorSelectForwardOnTracks] },
  {
    label: "Copy, cut, paste",
    shortcuts: [SHORTCUTS.editorCopy, SHORTCUTS.editorCut, SHORTCUTS.editorPaste],
  },
  { label: "Paste settings", shortcuts: [SHORTCUTS.editorPasteAttributes] },
  { label: "Undo, redo", shortcuts: [SHORTCUTS.editorUndo, SHORTCUTS.editorRedo] },
];

/** A row has room for one way to press each action. */
function firstChord(shortcut: ShortcutDefinition): ShortcutDefinition {
  return { ...shortcut, chords: shortcut.chords.slice(0, 1) };
}

interface ClipInspectorProps {
  project: Project;
  selection: Clip[];
  transitionId: string | null;
  /** The playhead: animated values are shown, and keyed, there. */
  time: number;
  onSeek: (time: number) => void;
  onEdit: ClipEdit;
  onTrackEdit: TrackEdit;
  onMixEdit: MixEdit;
  /** Adding, changing or removing a marker. */
  onMarkersEdit: (result: EditResult) => void;
  onSpeed: (speed: number) => void;
  /** Exact timing of the one selected clip: where it starts, its in point, and its length. */
  onStart: (seconds: number) => void;
  onSourceIn: (seconds: number) => void;
  onDuration: (seconds: number) => void;
  /** Sets one value on every selected clip it applies to. */
  onBatchEdit: BatchEdit;
  onBatchLength: (seconds: number) => void;
  /** Present while the clipboard holds a clip whose settings can be pasted. */
  onPasteAttributes?: () => void;
  onUnlink: () => void;
  onLink: () => void;
  onAddDissolve: () => void;
  onDissolveDuration: (seconds: number, final: boolean) => void;
  onRemoveDissolve: () => void;
  onDelete: () => void;
  /** Whether the wand is reading the selected clip's source right now. */
  autoPending: boolean;
  /** Asks the wand for the selected clip; the workspace applies what it suggests. */
  onAuto: () => void;
  /** Sound clips whose noise-reduced proxy is still rendering. */
  preparingSound: ReadonlySet<string>;
}

export function ClipInspector(props: ClipInspectorProps) {
  return (
    <SectionMemory>
      <InspectorContent {...props} />
    </SectionMemory>
  );
}

function InspectorContent({
  project,
  selection,
  transitionId,
  time,
  onSeek,
  onEdit,
  onTrackEdit,
  onMixEdit,
  onMarkersEdit,
  onSpeed,
  onStart,
  onSourceIn,
  onDuration,
  onBatchEdit,
  onBatchLength,
  onPasteAttributes,
  onUnlink,
  onLink,
  onAddDissolve,
  onDissolveDuration,
  onRemoveDissolve,
  onDelete,
  autoPending,
  onAuto,
  preparingSound,
}: ClipInspectorProps) {
  const transition = project.transitions.find((item) => item.id === transitionId);
  if (transition) {
    const overlap = transitionOverlap(project, transition);
    const outgoing = project.clips.find((clip) => clip.id === transition.from_clip_id);
    const incoming = project.clips.find((clip) => clip.id === transition.to_clip_id);
    const longest = Math.min(outgoing?.duration ?? 1, incoming?.duration ?? 1) - MIN_CLIP_SECONDS;
    return (
      <div className="video-editor__inspector-body">
        <InspectorHeader
          icon={iconBlend}
          kind="dissolve"
          title="Cross-dissolve"
          meta={`${outgoing ? clipLabel(project, outgoing) : "?"} → ${
            incoming ? clipLabel(project, incoming) : "?"
          }`}
        />
        <Panel title="Dissolve">
          <p className="video-editor__hint">
            Its length is the overlap; changing it slides the incoming clip and its sound.
          </p>
          <Slider
            label="Duration"
            value={overlap}
            min={MIN_CLIP_SECONDS}
            max={Math.max(MIN_CLIP_SECONDS, longest)}
            step={1 / project.frame_rate}
            format={(value) => `${value.toFixed(2)} s`}
            onChange={onDissolveDuration}
          />
          <div className="video-editor__inspector-actions">
            <button
              type="button"
              className="video-editor__secondary-btn video-editor__secondary-btn--danger"
              onClick={onRemoveDissolve}
            >
              <Icon icon={iconTrash2} /> Remove dissolve
            </button>
          </div>
        </Panel>
      </div>
    );
  }

  if (selection.length === 0) {
    return (
      <div className="video-editor__inspector-body">
        <div className="video-editor__project-card">
          <span className="video-editor__project-card-title">{project.name}</span>
          <dl className="video-editor__facts">
            <div>
              <dt>Frame</dt>
              <dd>
                {project.width} × {project.height}
              </dd>
            </div>
            <div>
              <dt>Rate</dt>
              <dd>{Number(project.frame_rate.toFixed(3))} fps</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>
                {formatTimecode(projectDuration(project), project.frame_rate)}
                <span className="video-editor__facts-seconds">
                  {formatClockSeconds(projectDuration(project))}
                </span>
              </dd>
            </div>
            <div>
              <dt>Clips</dt>
              <dd>{project.clips.length}</dd>
            </div>
          </dl>
        </div>
        <p className="video-editor__inspector-empty">
          Select a clip on the timeline to adjust it, or drag files from Media onto a track.
        </p>
        <MarkersPanel project={project} time={time} onSeek={onSeek} onEdit={onMarkersEdit} />
        <MixPanel project={project} onTrackEdit={onTrackEdit} onMixEdit={onMixEdit} />
        <Panel title="Keys">
          <ul className="video-editor__quick-keys">
            {QUICK_KEYS.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <span className="video-editor__quick-keys-caps">
                  {item.shortcuts.map((shortcut, index) => (
                    <Fragment key={index}>
                      <span className="video-editor__quick-keys-action">
                        <ShortcutKeys shortcut={firstChord(shortcut)} />
                      </span>
                      {index < item.shortcuts.length - 1 && <span aria-hidden="true"> </span>}
                    </Fragment>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    );
  }

  if (selection.length > 1) {
    const linkable =
      selection.filter((clip) => clip.kind === "video").length === 1 &&
      selection.some((clip) => clip.kind === "audio");
    return (
      <MultiClipInspector
        project={project}
        selection={selection}
        preparingSound={preparingSound}
        onBatchEdit={onBatchEdit}
        onBatchLength={onBatchLength}
        onPasteAttributes={onPasteAttributes}
        actions={
          <>
            {linkable && (
              <button type="button" className="video-editor__secondary-btn" onClick={onLink}>
                <Icon icon={iconLink} /> Link video and audio
              </button>
            )}
            <button
              type="button"
              className="video-editor__secondary-btn video-editor__secondary-btn--danger"
              onClick={onDelete}
            >
              <Icon icon={iconTrash2} /> Delete clips
            </button>
          </>
        }
      />
    );
  }

  const clip = selection[0];
  const source = sourceById(project, clip.source_id);
  const visual = clip.kind !== "audio";
  const timed = clip.kind === "video" || clip.kind === "audio";
  const outgoingDissolve = findTransition(project, clip.id).find((t) => t.from_clip_id === clip.id);
  const neighbour = visual ? nextNeighbour(project, clip) : undefined;
  const frame = 1 / project.frame_rate;
  const seconds = (value: number) => `${value.toFixed(2)} s`;

  return (
    <div className="video-editor__inspector-body" data-scroll-lock-allow>
      <InspectorHeader
        icon={KIND_ICONS[clip.kind]}
        kind={clip.kind}
        title={clipLabel(project, clip)}
        meta={`${formatTimecode(clip.start, project.frame_rate)} → ${formatTimecode(
          clipEnd(clip),
          project.frame_rate,
        )} · ${clip.duration.toFixed(2)} s`}
        detail={source && source.name !== clipLabel(project, clip) ? source.name : undefined}
        action={
          clip.link_id ? (
            <button type="button" className="video-editor__secondary-btn" onClick={onUnlink}>
              <Icon icon={iconUnlink} /> Unlink
            </button>
          ) : undefined
        }
      />

      {onPasteAttributes && (
        <div className="video-editor__inspector-actions video-editor__inspector-actions--padded">
          <button type="button" className="video-editor__secondary-btn" onClick={onPasteAttributes}>
            <Icon icon={iconClipboardPaste} /> Paste attributes...
          </button>
        </div>
      )}

      <Panel title="Timing" changed={clip.speed !== 1 || clip.fade_in > 0 || clip.fade_out > 0}>
        <div className="video-editor__timing">
          <label className="video-editor__field">
            <span>Start</span>
            <TimecodeField
              label="Start"
              value={clip.start}
              frameRate={project.frame_rate}
              onCommit={onStart}
            />
          </label>
          {timed && (
            <label className="video-editor__field">
              <Tooltip content="Where the take begins in the file; the clip stays in place">
                <span>In</span>
              </Tooltip>
              <TimecodeField
                label="In point"
                value={clip.source_in}
                frameRate={project.frame_rate}
                onCommit={onSourceIn}
              />
            </label>
          )}
          <label className="video-editor__field">
            <span>Length</span>
            <TimecodeField
              label="Length"
              value={clip.duration}
              frameRate={project.frame_rate}
              onCommit={onDuration}
            />
          </label>
        </div>
        {timed && (
          <div className="video-editor__field video-editor__field--stacked">
            <span id={`speed-${clip.id}`}>Speed</span>
            <div
              className="video-editor__chips"
              role="radiogroup"
              aria-labelledby={`speed-${clip.id}`}
            >
              {SPEED_PRESETS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  role="radio"
                  aria-checked={clip.speed === speed}
                  className={classNames(
                    "video-editor__chip",
                    clip.speed === speed && "video-editor__chip--on",
                  )}
                  onClick={() => onSpeed(speed)}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
        )}
        {timed && clip.speed !== 1 && (
          <p className="video-editor__hint">Sound keeps its pitch at any speed.</p>
        )}
        {/* Both scales span the whole clip, so moving one fade never moves the other's thumb;
            a fade dragged into the other stops where that one begins. */}
        <Slider
          label="Fade in"
          value={clip.fade_in}
          resting={0}
          min={0}
          max={clip.duration}
          step={frame}
          format={seconds}
          onChange={(value, final) =>
            onEdit({ fade_in: Math.min(value, clip.duration - clip.fade_out) }, final)
          }
        />
        <Slider
          label="Fade out"
          value={clip.fade_out}
          resting={0}
          min={0}
          max={clip.duration}
          step={frame}
          format={seconds}
          onChange={(value, final) =>
            onEdit({ fade_out: Math.min(value, clip.duration - clip.fade_in) }, final)
          }
        />
      </Panel>

      {clip.kind === "audio" && (
        <Panel title="Audio" changed={clip.gain !== 1 || clip.keyframes.gain.length > 0}>
          <KeyframeBar
            clip={clip}
            properties={["gain"]}
            time={time}
            onEdit={onEdit}
            onSeek={onSeek}
          />
          <KeyedSlider
            clip={clip}
            property="gain"
            time={time}
            label="Gain"
            resting={1}
            min={0}
            max={2}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onEdit={onEdit}
          />
          <div className="video-editor__field">
            <Tooltip content="The shape of its fades and crossfades">
              <span id={`curve-${clip.id}`}>Fades</span>
            </Tooltip>
            <div
              className="video-editor__segmented"
              role="radiogroup"
              aria-labelledby={`curve-${clip.id}`}
            >
              {FADE_CURVES.map((curve) => (
                <Tooltip key={curve.value} content={curve.hint} placement="top">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={clip.fade_curve === curve.value}
                    className={classNames(
                      "video-editor__segment",
                      clip.fade_curve === curve.value && "video-editor__segment--on",
                    )}
                    onClick={() => onEdit({ fade_curve: curve.value }, true)}
                  >
                    {curve.label}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {clip.kind === "audio" && (
        <SoundPanel
          effects={clip.audio_effects}
          preparing={preparingSound.has(clip.id)}
          onChange={(change, final) =>
            onEdit({ audio_effects: { ...clip.audio_effects, ...change } }, final)
          }
        />
      )}

      {clip.kind === "title" && clip.title && <TitlePanel clip={clip} onEdit={onEdit} />}

      {visual && (
        <Panel
          title="Transform"
          changed={
            !sameTransform(clip.transform, RESTING_TRANSFORM) ||
            clip.fit !== "fit" ||
            TRANSFORM_PROPERTIES.some((property) => clip.keyframes[property].length > 0)
          }
          action={
            <ResetButton
              label="Reset transform"
              onClick={() =>
                onEdit(
                  {
                    transform: RESTING_TRANSFORM,
                    fit: "fit",
                    keyframes: {
                      ...clip.keyframes,
                      x: [],
                      y: [],
                      scale: [],
                      rotation: [],
                      opacity: [],
                    },
                  },
                  true,
                )
              }
            />
          }
        >
          {clip.kind !== "title" && (
            <div
              className="video-editor__segmented video-editor__segmented--wide"
              role="radiogroup"
              aria-label="Fit"
            >
              {(["fit", "fill"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={clip.fit === mode}
                  className={classNames(
                    "video-editor__segment",
                    clip.fit === mode && "video-editor__segment--on",
                  )}
                  onClick={() => onEdit({ fit: mode }, true)}
                >
                  {mode === "fit" ? "Fit" : "Fill"}
                </button>
              ))}
            </div>
          )}
          <KeyframeBar
            clip={clip}
            properties={TRANSFORM_PROPERTIES}
            time={time}
            onEdit={onEdit}
            onSeek={onSeek}
          />
          <TransformSliders clip={clip} time={time} onEdit={onEdit} />
        </Panel>
      )}

      {(clip.kind === "video" || clip.kind === "image") && (
        <>
          <CropPanel clip={clip} onEdit={onEdit} />
          <ColorPanel clip={clip} onEdit={onEdit} autoPending={autoPending} onAuto={onAuto} />
        </>
      )}

      {visual && (
        <Panel title="Cross-dissolve" changed={Boolean(outgoingDissolve)}>
          {outgoingDissolve ? (
            <p className="video-editor__hint">
              Dissolves into the next clip over{" "}
              {transitionOverlap(project, outgoingDissolve).toFixed(2)} s. Select the dissolve on
              the timeline to change it.
            </p>
          ) : (
            <>
              <p className="video-editor__hint">
                {neighbour
                  ? "Overlaps the next clip on this track and blends between them; the next clip and its sound slide back."
                  : "Needs a following clip on the same track."}
              </p>
              <div className="video-editor__inspector-actions">
                <button
                  type="button"
                  className="video-editor__secondary-btn"
                  onClick={onAddDissolve}
                  disabled={!neighbour}
                >
                  <Icon icon={iconBlend} /> Add cross-dissolve
                </button>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

function sameTransform(a: Clip["transform"], b: Clip["transform"]): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.scale === b.scale &&
    a.rotation === b.rotation &&
    a.opacity === b.opacity
  );
}

const FADE_CURVES: { value: VideoProjectFadeCurve; label: string; hint: string }[] = [
  {
    value: "equal_power",
    label: "Equal power",
    hint: "Keeps a crossfade's loudness steady; best for music and ambience",
  },
  { value: "linear", label: "Linear", hint: "A straight ramp; dips in the middle of a crossfade" },
];

function TransformSliders({ clip, time, onEdit }: { clip: Clip; time: number; onEdit: ClipEdit }) {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const common = { clip, time, onEdit };
  return (
    <>
      <KeyedSlider
        {...common}
        property="x"
        label="Position X"
        resting={0}
        min={-1}
        max={1}
        step={0.005}
        format={percent}
      />
      <KeyedSlider
        {...common}
        property="y"
        label="Position Y"
        resting={0}
        min={-1}
        max={1}
        step={0.005}
        format={percent}
      />
      <KeyedSlider
        {...common}
        property="scale"
        label="Scale"
        resting={1}
        min={0.05}
        max={4}
        step={0.01}
        format={percent}
      />
      <KeyedSlider
        {...common}
        property="rotation"
        label="Rotation"
        resting={0}
        min={-180}
        max={180}
        step={1}
        format={(value) => `${Math.round(value)}°`}
      />
      <KeyedSlider
        {...common}
        property="opacity"
        label="Opacity"
        resting={1}
        min={0}
        max={1}
        step={0.01}
        format={percent}
      />
    </>
  );
}

function CropPanel({ clip, onEdit }: { clip: Clip; onEdit: ClipEdit }) {
  const crop = clip.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const set = (patch: Partial<typeof crop>, final: boolean) => {
    const next = { ...crop, ...patch };
    next.width = Math.min(next.width, 1 - next.x);
    next.height = Math.min(next.height, 1 - next.y);
    const whole = next.x === 0 && next.y === 0 && next.width === 1 && next.height === 1;
    onEdit({ crop: whole ? null : next }, final);
  };
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <Panel
      title="Crop"
      defaultOpen={false}
      changed={clip.crop !== null}
      action={<ResetButton label="Reset crop" onClick={() => onEdit({ crop: null }, true)} />}
    >
      <Slider
        label="Left"
        value={crop.x}
        resting={0}
        min={0}
        max={0.95}
        step={0.005}
        format={percent}
        onChange={(x, f) => set({ x }, f)}
      />
      <Slider
        label="Top"
        value={crop.y}
        resting={0}
        min={0}
        max={0.95}
        step={0.005}
        format={percent}
        onChange={(y, f) => set({ y }, f)}
      />
      <Slider
        label="Width"
        value={crop.width}
        resting={1 - crop.x}
        min={0.05}
        max={1 - crop.x}
        step={0.005}
        format={percent}
        onChange={(width, f) => set({ width }, f)}
      />
      <Slider
        label="Height"
        value={crop.height}
        resting={1 - crop.y}
        min={0.05}
        max={1 - crop.y}
        step={0.005}
        format={percent}
        onChange={(height, f) => set({ height }, f)}
      />
    </Panel>
  );
}

function ColorPanel({
  clip,
  onEdit,
  autoPending,
  onAuto,
}: {
  clip: Clip;
  onEdit: ClipEdit;
  autoPending: boolean;
  onAuto: () => void;
}) {
  const resting = restingAdjust();
  const auto = clip.auto_adjust ?? null;
  const set = (tool: AdjustTool, value: number, final: boolean) =>
    onEdit({ adjust: { ...clip.adjust, [tool]: value } as ColorAdjust }, final);
  return (
    <Panel
      title="Color"
      defaultOpen={false}
      changed={!isAdjustIdentity(clip.adjust) || auto !== null}
      action={
        <ResetButton
          label="Reset color"
          onClick={() => onEdit({ adjust: restingAdjust(), auto_adjust: null }, true)}
        />
      }
    >
      <div className="video-editor__auto">
        <Tooltip
          content={auto ? "Turn Auto off" : "Fix levels and color cast from this clip's frames"}
        >
          <button
            type="button"
            className={classNames("video-editor__auto-btn", auto && "video-editor__auto-btn--on")}
            aria-pressed={auto !== null}
            aria-busy={autoPending || undefined}
            disabled={autoPending}
            onClick={() => {
              if (!auto) onAuto();
              else onEdit({ adjust: withoutAuto(clip.adjust, auto), auto_adjust: null }, true);
            }}
          >
            <Icon icon={autoPending ? iconLoader2 : iconWandSparkles} spin={autoPending} />
            {autoPending ? "Reading frames..." : "Auto"}
          </button>
        </Tooltip>
        {auto ? (
          <Slider
            label="Amount"
            value={auto.amount}
            resting={AUTO_ADJUST_DEFAULT_AMOUNT}
            min={0}
            max={1}
            step={0.01}
            format={(amount) => String(Math.round(amount * 100))}
            onChange={(amount, final) => {
              const next = rescaleAuto(clip.adjust, auto, amount);
              onEdit({ adjust: next.adjust, auto_adjust: next.autoAdjust }, final);
            }}
          />
        ) : (
          <p className="video-editor__hint">
            Reads the clip's frames and sets levels and color for you; fine-tune below.
          </p>
        )}
      </div>
      <GradePresets
        current={clip.adjust}
        onApply={(adjust) => onEdit({ adjust, auto_adjust: null }, true)}
      />
      {COLOR_GROUPS.map((group) => (
        <div key={group.label} className="video-editor__group">
          <h4 className="video-editor__group-title">{group.label}</h4>
          {group.tools.map((tool) => {
            const range = adjustRange(tool.id);
            return (
              <Slider
                key={tool.id}
                label={tool.label}
                value={clip.adjust[tool.id]}
                resting={resting[tool.id]}
                min={range.min}
                max={range.max}
                step={range.step}
                format={(value) => formatAdjustValue(tool.id, value)}
                onChange={(value, final) => set(tool.id, value, final)}
              />
            );
          })}
        </div>
      ))}
    </Panel>
  );
}

function TitlePanel({ clip, onEdit }: { clip: Clip; onEdit: ClipEdit }) {
  const title = clip.title;
  const textId = useId();
  if (!title) return null;
  const set = (patch: Partial<typeof title>, final: boolean) =>
    onEdit({ title: { ...title, ...patch } }, final);
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <Panel title="Title">
      <label className="video-editor__field video-editor__field--stacked" htmlFor={textId}>
        <span>Text</span>
      </label>
      <textarea
        id={textId}
        className="video-editor__textarea"
        value={title.text}
        rows={3}
        maxLength={500}
        onChange={(event) => set({ text: event.target.value }, false)}
        onBlur={(event) => set({ text: event.target.value }, true)}
      />
      <div className="video-editor__field video-editor__field--stacked">
        <span>Font</span>
        <FontPicker value={title.font ?? null} onChange={(font) => set({ font }, true)} />
      </div>
      <div
        className="video-editor__segmented video-editor__segmented--wide"
        role="radiogroup"
        aria-label="Alignment"
      >
        {(["left", "center", "right"] as VideoProjectTitleAlign[]).map((align) => (
          <button
            key={align}
            type="button"
            role="radio"
            aria-checked={title.align === align}
            className={classNames(
              "video-editor__segment",
              title.align === align && "video-editor__segment--on",
            )}
            onClick={() => set({ align }, true)}
          >
            {align[0].toUpperCase() + align.slice(1)}
          </button>
        ))}
      </div>
      <Slider
        label="Size"
        value={title.size}
        resting={0.08}
        min={0.02}
        max={0.3}
        step={0.005}
        format={percent}
        onChange={(size, f) => set({ size }, f)}
      />
      <Slider
        label="Position X"
        value={title.x}
        resting={0.5}
        min={0}
        max={1}
        step={0.005}
        format={percent}
        onChange={(x, f) => set({ x }, f)}
      />
      <Slider
        label="Position Y"
        value={title.y}
        resting={0.5}
        min={0}
        max={1}
        step={0.005}
        format={percent}
        onChange={(y, f) => set({ y }, f)}
      />
      <Slider
        label="Outline"
        value={title.outline}
        resting={0.04}
        min={0}
        max={0.25}
        step={0.005}
        format={percent}
        onChange={(outline, f) => set({ outline }, f)}
      />
      <div className="video-editor__swatches">
        <label className="video-editor__swatch">
          <input
            type="color"
            value={title.color}
            aria-label="Text color"
            onChange={(event) => set({ color: event.target.value }, true)}
          />
          <span>Text</span>
        </label>
        <label className="video-editor__swatch">
          <input
            type="color"
            value={title.outline_color}
            aria-label="Outline color"
            onChange={(event) => set({ outline_color: event.target.value }, true)}
          />
          <span>Outline</span>
        </label>
      </div>
    </Panel>
  );
}
