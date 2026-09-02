import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CROP_ASPECTS, isIdentityCrop } from "@/features/gallery/lib/crop";
import {
  SCALE_PRESETS,
  formatRotation,
  formatScale,
  scaleForTargetHeight,
  scaleForTargetWidth,
} from "@/features/gallery/lib/imageEdit";
import { MASK_MODES, MASK_STRENGTHS, describeMasks } from "@/features/gallery/lib/mask";
import {
  COLOR_RANGES,
  formatDegrees,
  formatPercent,
  formatWarmth,
  isColorIdentity,
} from "@/features/gallery/lib/color";
import {
  iconContrast,
  iconCrop,
  iconDroplet,
  iconDroplets,
  iconEclipse,
  iconFlipHorizontal,
  iconFlipVertical,
  iconLoader2,
  iconMaximize2,
  iconPalette,
  iconPlus,
  iconRotateCcw,
  iconRotateCw,
  iconSun,
  iconThermometer,
  iconTrash2,
  iconUndo2,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { AppIcon } from "@/shared/icons";
import type { ImageEdit } from "@/features/gallery/hooks/useImageEdit";
import { SizeNumberField } from "./SizeNumberField";

type ToolId = "crop" | "blur" | "rotate" | "size" | "color";

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; icon: AppIcon }> = [
  { id: "crop", label: "Crop", icon: iconCrop },
  { id: "size", label: "Size", icon: iconMaximize2 },
  { id: "rotate", label: "Rotate", icon: iconRotateCw },
  { id: "blur", label: "Blur", icon: iconDroplets },
  { id: "color", label: "Color", icon: iconPalette },
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
    color: !isColorIdentity(edit.draft),
  };

  const { setCropActive, setMaskActive } = edit;

  // Keyed on the tool rather than on the click, or the one the panel opens on is never armed.
  useEffect(() => {
    setCropActive(activeTool === "crop");
    setMaskActive(activeTool === "blur");
  }, [activeTool, setCropActive, setMaskActive]);

  return (
    <div className="image-edit-panel" role="group" aria-label="Image editing">
      <div className="image-edit-panel__bar image-edit-panel__bar--tabs">
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
              onClick={() => setActiveTool(tool.id)}
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
              {modified.blur && (
                <span className="image-edit-panel__output-part">
                  {describeMasks(edit.draft.masks.length)}
                </span>
              )}
              {modified.rotate && (
                <span className="image-edit-panel__output-part">
                  {formatRotation(edit.draft.rotate)}
                  {edit.draft.mirrorH && " mirrored"}
                  {edit.draft.mirrorV && " flipped"}
                </span>
              )}
              {modified.color && (
                <span className="image-edit-panel__output-part">Color adjusted</span>
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
                <SizeNumberField
                  label="W"
                  className="image-edit-panel__field"
                  value={edit.outputWidth}
                  min={1}
                  step={1}
                  disabled={locked}
                  onCommit={(width) =>
                    edit.setScale(
                      scaleForTargetWidth(source, edit.draft.crop, edit.draft.rotate, width),
                    )
                  }
                />
                <SizeNumberField
                  label="H"
                  className="image-edit-panel__field"
                  value={edit.outputHeight}
                  min={1}
                  step={1}
                  disabled={locked}
                  onCommit={(height) =>
                    edit.setScale(
                      scaleForTargetHeight(source, edit.draft.crop, edit.draft.rotate, height),
                    )
                  }
                />
              </div>
            </>
          )}

          {activeTool === "rotate" && (
            <>
              <div className="image-edit-panel__presets" role="group" aria-label="Turn">
                <PresetButton disabled={locked} onClick={edit.rotateCounterClockwise}>
                  <Icon icon={iconRotateCcw} />
                  Rotate left
                </PresetButton>
                <PresetButton disabled={locked} onClick={edit.rotateClockwise}>
                  <Icon icon={iconRotateCw} />
                  Rotate right
                </PresetButton>
              </div>
              <div className="image-edit-panel__presets" role="group" aria-label="Mirror">
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
              </div>
            </>
          )}

          {activeTool === "color" && (
            <div className="image-edit-panel__sliders">
              <Slider
                label="Brightness"
                hint="Brightness"
                icon={iconSun}
                range={COLOR_RANGES.brightness}
                value={edit.draft.brightness}
                format={formatPercent}
                disabled={locked}
                onChange={edit.setBrightness}
              />
              <Slider
                label="Contrast"
                hint="Contrast"
                icon={iconContrast}
                range={COLOR_RANGES.contrast}
                value={edit.draft.contrast}
                format={formatPercent}
                disabled={locked}
                onChange={edit.setContrast}
              />
              <Slider
                label="Saturation"
                hint="Saturation"
                icon={iconDroplet}
                range={COLOR_RANGES.saturation}
                value={edit.draft.saturation}
                format={formatPercent}
                disabled={locked}
                onChange={edit.setSaturation}
              />
              <Slider
                label="Warmth"
                hint="Warmth"
                icon={iconThermometer}
                range={COLOR_RANGES.warmth}
                value={edit.draft.warmth}
                format={formatWarmth}
                disabled={locked}
                onChange={edit.setWarmth}
              />
              <Slider
                label="Hue"
                hint="Hue"
                icon={iconEclipse}
                range={COLOR_RANGES.hue}
                value={edit.draft.hue}
                format={formatDegrees}
                disabled={locked}
                onChange={edit.setHue}
              />
              <button
                type="button"
                className="image-edit-panel__control"
                disabled={locked || !modified.color}
                onClick={edit.resetColor}
              >
                Reset colors
              </button>
            </div>
          )}

          {activeTool === "blur" && (
            <>
              <div className="image-edit-panel__tool-actions">
                <button
                  type="button"
                  className="image-edit-panel__control"
                  disabled={locked || edit.maskLimitReached}
                  onClick={edit.addMask}
                >
                  <Icon icon={iconPlus} />
                  Add
                </button>
                <button
                  type="button"
                  className="image-edit-panel__control"
                  disabled={locked || !modified.blur}
                  onClick={edit.clearMasks}
                >
                  <Icon icon={iconTrash2} />
                  Clear
                </button>
              </div>
              <ToolPresets label="Blur style">
                {MASK_MODES.map((mode) => (
                  <PresetButton
                    key={mode.id}
                    active={edit.maskMode === mode.id}
                    disabled={locked}
                    onClick={() => edit.setMaskMode(mode.id)}
                  >
                    {mode.label}
                  </PresetButton>
                ))}
              </ToolPresets>
              <ToolPresets label="Strength">
                {MASK_STRENGTHS.map((strength) => (
                  <PresetButton
                    key={strength.id}
                    active={edit.maskStrength === strength.value}
                    // A blackout has nothing to measure, so its strength would go nowhere.
                    disabled={locked || edit.maskMode === "blackout"}
                    onClick={() => edit.setMaskStrength(strength.value)}
                  >
                    {strength.label}
                  </PresetButton>
                ))}
              </ToolPresets>
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

/** Icon-labelled so all five fit one row; the tooltip is what names and explains each one. */
function Slider({
  label,
  hint,
  icon,
  range,
  value,
  format,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  icon: AppIcon;
  range: { min: number; max: number; step: number };
  value: number;
  format: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Tooltip content={hint}>
      <label className="image-edit-panel__slider">
        <Icon icon={icon} />
        <input
          type="range"
          className="image-edit-panel__slider-input"
          // The wrapping label also holds the live value, so name the control on its own.
          aria-label={label}
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="image-edit-panel__slider-value">{format(value)}</span>
      </label>
    </Tooltip>
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
  active?: boolean;
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
