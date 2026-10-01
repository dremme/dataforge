import { useEffect, useMemo, useState } from "react";
import { isIdentityCrop } from "@/features/gallery/lib/crop";
import {
  formatRotation,
  scaleForTargetHeight,
  scaleForTargetWidth,
} from "@/features/gallery/lib/imageEdit";
import { describeMasks } from "@/features/gallery/lib/mask";
import { isAdjustIdentity } from "@/features/gallery/lib/colorAdjust";
import {
  iconCrop,
  iconDroplets,
  iconFlipHorizontal,
  iconFlipVertical,
  iconLoader2,
  iconMaximize2,
  iconRotateCcw,
  iconRotateCw,
  iconSliders,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import type { ImageEdit } from "@/features/gallery/hooks/useImageEdit";
import { AdjustTools } from "./AdjustTools";
import {
  AspectTools,
  BlurTools,
  EditActions,
  OutputChange,
  OutputPart,
  PresetButton,
  SizeTools,
  ToolPresets,
  ToolTabs,
  type EditTool,
} from "./EditPanelParts";

type ToolId = "crop" | "blur" | "rotate" | "size" | "adjust";

const TOOLS: ReadonlyArray<EditTool<ToolId>> = [
  { id: "crop", label: "Crop", icon: iconCrop },
  { id: "size", label: "Size", icon: iconMaximize2 },
  { id: "rotate", label: "Rotate", icon: iconRotateCw },
  { id: "adjust", label: "Adjust", icon: iconSliders },
  { id: "blur", label: "Blur", icon: iconDroplets },
];

interface ImageEditPanelProps {
  edit: ImageEdit;
  busy: boolean;
  onRevertRequested: () => void;
}

export function ImageEditPanel({ edit, busy, onRevertRequested }: ImageEditPanelProps) {
  const [activeTool, setActiveTool] = useState<ToolId>("crop");

  const locked = !edit.ready || busy || edit.applying;
  const source = useMemo(
    () => ({ width: edit.sourceWidth, height: edit.sourceHeight }),
    [edit.sourceHeight, edit.sourceWidth],
  );
  const modified: Record<ToolId, boolean> = {
    crop: !isIdentityCrop(edit.draft.crop),
    blur: edit.draft.masks.length > 0,
    rotate: edit.draft.rotate !== 0 || edit.draft.mirrorH || edit.draft.mirrorV,
    size: edit.draft.scale !== 1,
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
    <div className="edit-panel" role="group" aria-label="Image editing">
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
              {modified.rotate && (
                <OutputPart>
                  {formatRotation(edit.draft.rotate)}
                  {edit.draft.mirrorH && " mirrored"}
                  {edit.draft.mirrorV && " flipped"}
                </OutputPart>
              )}
              {modified.adjust && (
                <OutputPart>
                  {edit.adjust.previewAvailable
                    ? "Adjusted"
                    : "Adjusted, no live preview in this browser"}
                </OutputPart>
              )}
            </>
          ) : (
            <OutputPart>The tools load with the image.</OutputPart>
          )}
        </p>
      </div>

      <div className="edit-panel__bar edit-panel__bar--tool">
        <div className="edit-panel__tool-controls">
          {activeTool === "crop" && (
            <AspectTools aspectId={edit.aspectId} disabled={locked} onSelect={edit.selectAspect} />
          )}

          {activeTool === "size" && (
            <SizeTools
              scale={edit.draft.scale}
              width={edit.outputWidth}
              height={edit.outputHeight}
              step={1}
              disabled={locked}
              onScale={edit.setScale}
              onWidth={(width) =>
                edit.setScale(
                  scaleForTargetWidth(source, edit.draft.crop, edit.draft.rotate, width),
                )
              }
              onHeight={(height) =>
                edit.setScale(
                  scaleForTargetHeight(source, edit.draft.crop, edit.draft.rotate, height),
                )
              }
            />
          )}

          {activeTool === "rotate" && (
            <>
              <ToolPresets label="Turn">
                <PresetButton disabled={locked} onClick={edit.rotateCounterClockwise}>
                  <Icon icon={iconRotateCcw} />
                  Rotate left
                </PresetButton>
                <PresetButton disabled={locked} onClick={edit.rotateClockwise}>
                  <Icon icon={iconRotateCw} />
                  Rotate right
                </PresetButton>
              </ToolPresets>
              <ToolPresets label="Mirror">
                <PresetButton
                  active={edit.draft.mirrorH}
                  disabled={locked}
                  onClick={edit.toggleMirrorH}
                >
                  <Icon icon={iconFlipHorizontal} />
                  Flip hori.
                </PresetButton>
                <PresetButton
                  active={edit.draft.mirrorV}
                  disabled={locked}
                  onClick={edit.toggleMirrorV}
                >
                  <Icon icon={iconFlipVertical} />
                  Flip vert.
                </PresetButton>
              </ToolPresets>
            </>
          )}

          {activeTool === "adjust" && <AdjustTools controls={edit.adjust} disabled={locked} />}

          {activeTool === "blur" && (
            <BlurTools masks={edit} hasRegions={modified.blur} disabled={locked} />
          )}
        </div>

        {edit.applying ? (
          <div className="edit-panel__actions">
            <span className="edit-panel__rendering" role="status">
              <Icon icon={iconLoader2} spin />
              Saving
            </span>
          </div>
        ) : (
          <EditActions edit={edit} disabled={locked} onRevertRequested={onRevertRequested} />
        )}
      </div>
    </div>
  );
}
