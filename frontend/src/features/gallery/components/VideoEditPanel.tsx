import { useEffect, useMemo, useState } from "react";
import { isIdentityCrop } from "@/features/gallery/lib/crop";
import { isAdjustIdentity } from "@/features/gallery/lib/colorAdjust";
import {
  SPEED_PRESETS,
  VOLUME_PRESETS,
  formatSpeed,
  formatVolume,
  scaleForTargetHeight,
  scaleForTargetWidth,
} from "@/features/gallery/lib/videoEdit";
import { describeMasks } from "@/features/gallery/lib/mask";
import { formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import {
  iconCrop,
  iconDroplets,
  iconGauge,
  iconLoader2,
  iconMaximize2,
  iconScissors,
  iconSliders,
  iconVolume2,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import type { VideoEdit } from "@/features/gallery/hooks/useVideoEdit";
import { AdjustTools } from "./AdjustTools";
import {
  AspectTools,
  BlurTools,
  EditActions,
  OutputChange,
  OutputPart,
  PresetChoices,
  SizeTools,
  ToolTabs,
  type EditTool,
} from "./EditPanelParts";
import { VideoEditTimeline } from "./VideoEditTimeline";

type ToolId = "trim" | "crop" | "blur" | "speed" | "size" | "volume" | "adjust";

const TOOLS: ReadonlyArray<EditTool<ToolId>> = [
  { id: "trim", label: "Trim", icon: iconScissors },
  { id: "speed", label: "Speed", icon: iconGauge },
  { id: "volume", label: "Volume", icon: iconVolume2 },
  { id: "crop", label: "Crop", icon: iconCrop },
  { id: "size", label: "Size", icon: iconMaximize2 },
  { id: "adjust", label: "Adjust", icon: iconSliders },
  { id: "blur", label: "Blur", icon: iconDroplets },
];

interface VideoEditPanelProps {
  edit: VideoEdit;
  busy: boolean;
  onRevertRequested: () => void;
}

export function VideoEditPanel({ edit, busy, onRevertRequested }: VideoEditPanelProps) {
  const [activeTool, setActiveTool] = useState<ToolId>("trim");

  const locked = !edit.ready || busy || edit.applying;
  const source = useMemo(
    () => ({ width: edit.sourceWidth, height: edit.sourceHeight }),
    [edit.sourceHeight, edit.sourceWidth],
  );
  const modified: Record<ToolId, boolean> = {
    trim: edit.draft.trimStart > 0 || (edit.ready && edit.draft.trimEnd < edit.duration),
    crop: !isIdentityCrop(edit.draft.crop),
    blur: edit.draft.masks.length > 0,
    speed: edit.draft.speed !== 1,
    size: edit.draft.scale !== 1,
    volume: edit.draft.volume !== 1,
    adjust: !isAdjustIdentity(edit.draft.adjust),
  };

  const { setCropActive, setMaskActive } = edit;
  const { setActive: setAdjustActive } = edit.adjust;

  // Keyed on the tool rather than on the click, or the one the panel opens on is never armed.
  useEffect(() => {
    setCropActive(activeTool === "crop");
    setMaskActive(activeTool === "blur");
    setAdjustActive(activeTool === "adjust");
  }, [activeTool, setAdjustActive, setCropActive, setMaskActive]);

  return (
    <div className="edit-panel" role="group" aria-label="Video editing">
      <VideoEditTimeline
        duration={edit.duration}
        trimStart={edit.draft.trimStart}
        trimEnd={edit.draft.trimEnd}
        speed={edit.draft.speed}
        frameDuration={edit.frameDuration}
        playheadTime={edit.playheadTime}
        playheadRef={edit.playheadRef}
        playing={edit.playing}
        muted={edit.muted}
        ready={edit.ready}
        disabled={busy || edit.applying}
        onTrimStartChange={edit.setTrimStart}
        onTrimEndChange={edit.setTrimEnd}
        onSeek={edit.seekTo}
        onTogglePlay={edit.togglePlay}
        onToggleMuted={edit.toggleMuted}
      />

      <div className="edit-panel__bar edit-panel__bar--tabs">
        <ToolTabs
          tools={TOOLS}
          activeTool={activeTool}
          modified={modified}
          disabled={locked}
          onSelect={setActiveTool}
        />

        <p className="edit-panel__output">
          {edit.ready ? (
            <>
              <OutputChange
                from={`${edit.sourceWidth} x ${edit.sourceHeight}`}
                to={`${edit.outputWidth} x ${edit.outputHeight}`}
              />
              {modified.blur && <OutputPart>{describeMasks(edit.draft.masks.length)}</OutputPart>}
              {modified.volume && (
                <OutputPart>
                  {edit.draft.volume === 0 ? "Muted" : `Volume ${formatVolume(edit.draft.volume)}`}
                </OutputPart>
              )}
              {modified.adjust && (
                <OutputPart>
                  {edit.adjust.previewAvailable
                    ? "Adjusted"
                    : "Adjusted, no live preview in this browser"}
                </OutputPart>
              )}
              <OutputChange
                from={formatFrameTime(edit.duration)}
                to={formatFrameTime(edit.outputSeconds)}
              />
            </>
          ) : (
            <OutputPart>The timeline loads with the video.</OutputPart>
          )}
        </p>
      </div>

      <div className="edit-panel__bar edit-panel__bar--tool">
        <div className="edit-panel__tool-controls">
          {activeTool === "trim" && (
            <>
              <div className="edit-panel__tool-actions">
                <button
                  type="button"
                  className="edit-panel__control"
                  disabled={locked}
                  onClick={edit.setTrimStartAtPlayhead}
                >
                  Set in
                </button>
                <button
                  type="button"
                  className="edit-panel__control"
                  disabled={locked}
                  onClick={edit.setTrimEndAtPlayhead}
                >
                  Set out
                </button>
              </div>
              <span className="edit-panel__hint">
                Both follow the playhead. Drag a handle, or nudge it with the arrow keys.
              </span>
            </>
          )}

          {activeTool === "speed" && (
            <PresetChoices
              label="Playback"
              values={SPEED_PRESETS}
              current={edit.draft.speed}
              format={formatSpeed}
              disabled={locked}
              onSelect={edit.setSpeed}
            />
          )}

          {activeTool === "volume" && (
            <PresetChoices
              label="Volume"
              values={VOLUME_PRESETS}
              current={edit.draft.volume}
              format={formatVolume}
              disabled={locked}
              onSelect={edit.setVolume}
            />
          )}

          {activeTool === "adjust" && <AdjustTools controls={edit.adjust} disabled={locked} />}

          {activeTool === "crop" && (
            <AspectTools aspectId={edit.aspectId} disabled={locked} onSelect={edit.selectAspect} />
          )}

          {activeTool === "size" && (
            <SizeTools
              scale={edit.draft.scale}
              width={edit.outputWidth}
              height={edit.outputHeight}
              step={2}
              disabled={locked}
              onScale={edit.setScale}
              onWidth={(width) =>
                edit.setScale(scaleForTargetWidth(source, edit.draft.crop, width))
              }
              onHeight={(height) =>
                edit.setScale(scaleForTargetHeight(source, edit.draft.crop, height))
              }
            />
          )}

          {activeTool === "blur" && (
            <BlurTools masks={edit} hasRegions={modified.blur} disabled={locked} />
          )}
        </div>

        {edit.applying ? (
          <div className="edit-panel__actions">
            <span
              className="edit-panel__rendering"
              role="progressbar"
              aria-label="Rendering"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={edit.progress == null ? undefined : Math.round(edit.progress * 100)}
            >
              <Icon icon={iconLoader2} spin />
              {edit.progress == null ? "Rendering" : `${Math.round(edit.progress * 100)}%`}
            </span>
            <button type="button" className="edit-panel__control" onClick={edit.cancel}>
              Cancel
            </button>
          </div>
        ) : (
          <EditActions edit={edit} disabled={locked} onRevertRequested={onRevertRequested} />
        )}
      </div>
    </div>
  );
}
