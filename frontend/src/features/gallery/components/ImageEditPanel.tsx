import { useMemo, useState, type ReactNode } from "react";
import { CROP_ASPECTS, isIdentityCrop } from "@/features/gallery/lib/crop";
import {
  SCALE_PRESETS,
  formatRotation,
  formatScale,
  scaleForTargetHeight,
  scaleForTargetWidth,
} from "@/features/gallery/lib/imageEdit";
import {
  iconCrop,
  iconFlipHorizontal,
  iconFlipVertical,
  iconLoader2,
  iconMaximize2,
  iconRotateCcw,
  iconRotateCw,
  iconUndo2,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import type { AppIcon } from "@/shared/icons";
import type { ImageEdit } from "@/features/gallery/hooks/useImageEdit";

type ToolId = "crop" | "rotate" | "size";

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; icon: AppIcon }> = [
  { id: "crop", label: "Crop", icon: iconCrop },
  { id: "rotate", label: "Rotate", icon: iconRotateCw },
  { id: "size", label: "Size", icon: iconMaximize2 },
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
    rotate: edit.draft.rotate !== 0 || edit.draft.mirrorH || edit.draft.mirrorV,
    size: edit.draft.scale !== 1,
  };

  const selectTool = (tool: ToolId) => {
    setActiveTool(tool);
    // Selecting the crop tool is what brings the handles out, the way picking a tool
    // reveals its gizmo anywhere else.
    edit.setCropActive(tool === "crop");
  };

  return (
    <div className="image-edit-panel" role="group" aria-label="Image editing">
      <div className="image-edit-panel__bar">
        <div className="image-edit-panel__tools" role="group" aria-label="Editing tool">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={classNames(
                "image-edit-panel__tool",
                activeTool === tool.id && "image-edit-panel__tool--active",
                modified[tool.id] && "image-edit-panel__tool--modified",
              )}
              aria-pressed={activeTool === tool.id}
              aria-label={modified[tool.id] ? `${tool.label}, changed` : tool.label}
              disabled={locked}
              onClick={() => selectTool(tool.id)}
            >
              <Icon icon={tool.icon} />
              {tool.label}
            </button>
          ))}
        </div>

        <p className="image-edit-panel__output">
          {edit.ready ? (
            <>
              <span className="image-edit-panel__output-part">
                {edit.sourceWidth} x {edit.sourceHeight}
                <span className="image-edit-panel__output-arrow"> to </span>
                <strong>
                  {edit.outputWidth} x {edit.outputHeight}
                </strong>
              </span>
              {modified.rotate && (
                <span className="image-edit-panel__output-part">
                  {formatRotation(edit.draft.rotate)}
                  {edit.draft.mirrorH && " mirrored"}
                  {edit.draft.mirrorV && " flipped"}
                </span>
              )}
            </>
          ) : (
            <span className="image-edit-panel__output-part">The tools load with the image.</span>
          )}
        </p>
      </div>

      <div className="image-edit-panel__bar image-edit-panel__bar--tool">
        <div className="image-edit-panel__tool-controls">
          {activeTool === "crop" && (
            <>
              <ToolPresets label="Aspect">
                {CROP_ASPECTS.map((aspect) => (
                  <PresetButton
                    key={aspect.id}
                    active={edit.aspectId === aspect.id}
                    disabled={locked}
                    onClick={() => edit.selectAspect(aspect.id)}
                  >
                    {aspect.label}
                  </PresetButton>
                ))}
              </ToolPresets>
              <span className="image-edit-panel__hint">Or drag the rectangles on the image.</span>
            </>
          )}

          {activeTool === "rotate" && (
            <>
              <div className="image-edit-panel__presets" role="group" aria-label="Turn">
                <IconAction
                  icon={iconRotateCcw}
                  label="Rotate left 90°"
                  disabled={locked}
                  onClick={edit.rotateCounterClockwise}
                />
                <IconAction
                  icon={iconRotateCw}
                  label="Rotate right 90°"
                  disabled={locked}
                  onClick={edit.rotateClockwise}
                />
              </div>
              <div className="image-edit-panel__presets" role="group" aria-label="Mirror">
                <IconAction
                  icon={iconFlipHorizontal}
                  label="Mirror horizontally"
                  pressed={edit.draft.mirrorH}
                  disabled={locked}
                  onClick={edit.toggleMirrorH}
                />
                <IconAction
                  icon={iconFlipVertical}
                  label="Mirror vertically"
                  pressed={edit.draft.mirrorV}
                  disabled={locked}
                  onClick={edit.toggleMirrorV}
                />
              </div>
              <span className="image-edit-panel__hint">
                Applied after the crop, so the rectangle stays on the pixels you framed.
              </span>
            </>
          )}

          {activeTool === "size" && (
            <>
              <ToolPresets label="Scale">
                {SCALE_PRESETS.map((scale) => (
                  <PresetButton
                    key={scale}
                    active={edit.draft.scale === scale}
                    disabled={locked}
                    onClick={() => edit.setScale(scale)}
                  >
                    {formatScale(scale)}
                  </PresetButton>
                ))}
              </ToolPresets>
              <div className="image-edit-panel__fields">
                <label className="image-edit-panel__field">
                  <span>W</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={edit.outputWidth}
                    disabled={locked}
                    onChange={(event) =>
                      edit.setScale(
                        scaleForTargetWidth(
                          source,
                          edit.draft.crop,
                          edit.draft.rotate,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                </label>
                <label className="image-edit-panel__field">
                  <span>H</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={edit.outputHeight}
                    disabled={locked}
                    onChange={(event) =>
                      edit.setScale(
                        scaleForTargetHeight(
                          source,
                          edit.draft.crop,
                          edit.draft.rotate,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                </label>
              </div>
            </>
          )}
        </div>

        {edit.applying ? (
          <div className="image-edit-panel__actions">
            <span className="image-edit-panel__rendering" role="status">
              <Icon icon={iconLoader2} spin />
              Saving
            </span>
          </div>
        ) : (
          <div className="image-edit-panel__actions">
            {edit.hasBackup && (
              <button
                type="button"
                className="image-edit-panel__control image-edit-panel__control--revert"
                disabled={locked}
                onClick={onRevertRequested}
              >
                <Icon icon={iconUndo2} />
                Revert original
              </button>
            )}
            <button
              type="button"
              className="image-edit-panel__control"
              disabled={locked || !edit.dirty}
              onClick={edit.resetDraft}
            >
              Reset
            </button>
            <button
              type="button"
              className="image-edit-panel__apply"
              disabled={locked || !edit.dirty}
              onClick={edit.apply}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolPresets({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="image-edit-panel__presets" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function PresetButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={classNames(
        "image-edit-panel__preset",
        active && "image-edit-panel__preset--active",
      )}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** pressed is omitted for quarter turns: they compose rather than latch, so it would lie. */
function IconAction({
  icon,
  label,
  pressed,
  disabled,
  onClick,
}: {
  icon: AppIcon;
  label: string;
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={classNames(
        "image-edit-panel__preset",
        "image-edit-panel__preset--icon",
        pressed && "image-edit-panel__preset--active",
      )}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={icon} />
    </button>
  );
}
