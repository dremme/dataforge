import {
  iconArrowLeftRight,
  iconArrowRightFromLine,
  iconCopy,
  iconFilm,
  iconMagnet,
  iconMaximize2,
  iconMousePointer,
  iconMusic,
  iconRangeSelect,
  iconRedo2,
  iconScissors,
  iconTrash2,
  iconType,
  iconUndo2,
  iconX,
  iconZoomIn,
  iconZoomOut,
} from "@/shared/icons";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import { rangeFill } from "@/features/videoEditor/lib/rangeFill";
import {
  formatTimecode,
  rippleTouchedTracks,
  type Project,
  type TimeRange,
} from "@/features/videoEditor/lib/timeline";
import type { TimelineTool } from "./Timeline";
import { ToolButton } from "./ToolButton";

export const MIN_PX_PER_SECOND = 2;
export const MAX_PX_PER_SECOND = 600;

interface TimelineToolbarProps {
  project: Project;
  tool: TimelineTool;
  onTool: (tool: TimelineTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  canDuplicate: boolean;
  onDuplicate: () => void;
  canDelete: boolean;
  onDelete: () => void;
  range: TimeRange | null;
  onRipple: () => void;
  onClearRange: () => void;
  onAddTitle: () => void;
  onAddVideoTrack: () => void;
  onAddAudioTrack: () => void;
  snapping: boolean;
  onSnapping: () => void;
  pxPerSecond: number;
  onZoom: (pxPerSecond: number) => void;
  onFit: () => void;
}

const TOOLS: {
  id: TimelineTool;
  icon: typeof iconMousePointer;
  label: string;
  tooltip: string;
  shortcut: (typeof SHORTCUTS)[keyof typeof SHORTCUTS];
}[] = [
  {
    id: "select",
    icon: iconMousePointer,
    label: "Select",
    tooltip: "Select: move, trim and choose clips",
    shortcut: SHORTCUTS.editorSelectTool,
  },
  {
    id: "blade",
    icon: iconScissors,
    label: "Blade",
    tooltip: "Blade: click a clip to cut it there",
    shortcut: SHORTCUTS.editorBladeTool,
  },
  {
    id: "range",
    icon: iconRangeSelect,
    label: "Range",
    tooltip: "Range: drag across the timeline to mark time for ripple delete",
    shortcut: SHORTCUTS.editorRangeTool,
  },
  {
    id: "ripple",
    icon: iconArrowRightFromLine,
    label: "Ripple trim",
    tooltip: "Ripple trim: drag an edge and everything after the clip follows",
    shortcut: SHORTCUTS.editorRippleTool,
  },
  {
    id: "roll",
    icon: iconArrowLeftRight,
    label: "Roll trim",
    tooltip: "Roll trim: drag a cut to move it between the two clips it joins",
    shortcut: SHORTCUTS.editorRollTool,
  },
];

/** Tools on the left, edits in the middle, view controls on the right. */
export function TimelineToolbar({
  project,
  tool,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSplit,
  canDuplicate,
  onDuplicate,
  canDelete,
  onDelete,
  range,
  onRipple,
  onClearRange,
  onAddTitle,
  onAddVideoTrack,
  onAddAudioTrack,
  snapping,
  onSnapping,
  pxPerSecond,
  onZoom,
  onFit,
}: TimelineToolbarProps) {
  const ranged = range !== null && range.end - range.start > 0;
  return (
    <div className="video-editor__toolbar" role="toolbar" aria-label="Timeline tools">
      <div className="video-editor__tool-group video-editor__tool-group--tools">
        {TOOLS.map((item) => (
          <ToolButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            tooltip={item.tooltip}
            shortcut={item.shortcut}
            pressed={tool === item.id}
            onClick={() => onTool(item.id)}
          />
        ))}
      </div>
      <div className="video-editor__tool-group">
        <ToolButton
          icon={iconUndo2}
          label="Undo"
          shortcut={SHORTCUTS.editorUndo}
          disabled={!canUndo}
          onClick={onUndo}
        />
        <ToolButton
          icon={iconRedo2}
          label="Redo"
          shortcut={SHORTCUTS.editorRedo}
          disabled={!canRedo}
          onClick={onRedo}
        />
      </div>
      <div className="video-editor__tool-group">
        <ToolButton
          icon={iconScissors}
          label="Split at playhead"
          shortcut={SHORTCUTS.editorSplit}
          onClick={onSplit}
        />
        <ToolButton
          icon={iconCopy}
          label="Duplicate"
          shortcut={SHORTCUTS.editorDuplicate}
          disabled={!canDuplicate}
          onClick={onDuplicate}
        />
        <ToolButton
          icon={iconTrash2}
          label="Delete"
          shortcut={SHORTCUTS.editorDelete}
          disabled={!canDelete}
          onClick={onDelete}
        />
        <ToolButton
          icon={iconRangeSelect}
          label="Ripple delete"
          showLabel
          tooltip="Removes the marked range from every track with sync lock on and closes the gap"
          shortcut={SHORTCUTS.editorRippleDelete}
          disabled={!ranged}
          onClick={onRipple}
        />
      </div>
      <div className="video-editor__tool-group">
        <ToolButton icon={iconType} label="Add title" onClick={onAddTitle} />
        <ToolButton icon={iconFilm} label="Add video track" onClick={onAddVideoTrack} />
        <ToolButton icon={iconMusic} label="Add audio track" onClick={onAddAudioTrack} />
      </div>
      {ranged && range && <RangeChip project={project} range={range} onClear={onClearRange} />}
      <span className="video-editor__spacer" />
      <ToolButton
        icon={iconMagnet}
        label="Snapping"
        tooltip={snapping ? "Snapping on: edges and the playhead attract" : "Snapping off"}
        shortcut={SHORTCUTS.editorSnapping}
        pressed={snapping}
        onClick={onSnapping}
      />
      <div className="video-editor__zoom-group">
        <ToolButton
          icon={iconZoomOut}
          label="Zoom out"
          shortcut={SHORTCUTS.editorZoomOut}
          onClick={() => onZoom(pxPerSecond / 1.5)}
        />
        <input
          type="range"
          className="video-editor__zoom"
          aria-label="Timeline zoom"
          min={Math.log(MIN_PX_PER_SECOND)}
          max={Math.log(MAX_PX_PER_SECOND)}
          step={0.01}
          value={Math.log(pxPerSecond)}
          style={rangeFill(
            Math.log(pxPerSecond),
            Math.log(MIN_PX_PER_SECOND),
            Math.log(MAX_PX_PER_SECOND),
          )}
          onChange={(event) => onZoom(Math.exp(Number(event.target.value)))}
        />
        <ToolButton
          icon={iconZoomIn}
          label="Zoom in"
          shortcut={SHORTCUTS.editorZoomIn}
          onClick={() => onZoom(pxPerSecond * 1.5)}
        />
        <ToolButton
          icon={iconMaximize2}
          label="Fit the project"
          shortcut={SHORTCUTS.editorZoomFit}
          onClick={onFit}
        />
      </div>
    </div>
  );
}

/** The marked range, what ripple delete will do with it, and a way to let go of it. */
function RangeChip({
  project,
  range,
  onClear,
}: {
  project: Project;
  range: TimeRange;
  onClear: () => void;
}) {
  const locked = rippleTouchedTracks(project, range).filter((track) => track.locked);
  return (
    <Tooltip
      content={
        locked.length > 0
          ? `Unlock ${locked.map((track) => track.name).join(", ")} before a ripple delete.`
          : "Ripple delete removes this range from every track with sync lock on and moves everything after it back."
      }
      placement="top"
    >
      <span className="video-editor__range-chip" role="status">
        <span className="video-editor__range-times">
          {formatTimecode(range.start, project.frame_rate)} –{" "}
          {formatTimecode(range.end, project.frame_rate)}
        </span>
        <span className="video-editor__range-length">{(range.end - range.start).toFixed(2)} s</span>
        {locked.length > 0 && <span className="video-editor__range-locked">locked track</span>}
        <button
          type="button"
          className="video-editor__icon-btn"
          aria-label="Clear range"
          onClick={onClear}
        >
          <Icon icon={iconX} />
        </button>
      </span>
    </Tooltip>
  );
}
