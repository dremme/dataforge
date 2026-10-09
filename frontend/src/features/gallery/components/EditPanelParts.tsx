import { useId, type ReactNode } from "react";
import { CROP_ASPECTS } from "@/features/gallery/lib/crop";
import { SCALE_PRESETS, formatScale } from "@/features/gallery/lib/editSpec";
import { MASK_MODES, MASK_STRENGTHS } from "@/features/gallery/lib/mask";
import type { MaskRegionControls } from "@/features/gallery/hooks/useMaskRegions";
import type { ColorAdjustControls } from "@/features/gallery/hooks/useColorAdjust";
import { iconPlus, iconTrash2, iconUndo2, type AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { SizeNumberField } from "./SizeNumberField";

/** Pieces the image and video edit panels share; both render inside `.edit-panel`. */

export interface EditTool<T extends string> {
  id: T;
  label: string;
  icon: AppIcon;
}

export function ToolTabs<T extends string>({
  tools,
  activeTool,
  modified,
  disabled,
  onSelect,
}: {
  tools: ReadonlyArray<EditTool<T>>;
  activeTool: T;
  modified: Record<T, boolean>;
  disabled: boolean;
  onSelect: (tool: T) => void;
}) {
  return (
    <div className="edit-panel__tools" role="group" aria-label="Editing tool">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={classNames(
            "edit-panel__tool",
            activeTool === tool.id && "edit-panel__tool--active",
            modified[tool.id] && "edit-panel__tool--modified",
          )}
          aria-pressed={activeTool === tool.id}
          aria-label={modified[tool.id] ? `${tool.label}, changed` : tool.label}
          disabled={disabled}
          onClick={() => onSelect(tool.id)}
        >
          <Icon icon={tool.icon} />
          {tool.label}
        </button>
      ))}
    </div>
  );
}

export function OutputPart({ children }: { children: ReactNode }) {
  return <span className="edit-panel__output-part">{children}</span>;
}

/** "From to **to**", the shape every before-and-after readout in the bar takes. */
export function OutputChange({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <OutputPart>
      {from}
      <span className="edit-panel__output-arrow"> to </span>
      <strong>{to}</strong>
    </OutputPart>
  );
}

/** A control cluster under a visible caption, which also names the group. */
export function ToolGroup({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="edit-panel__group">
      <span id={labelId} className="edit-panel__group-label">
        {label}
      </span>
      <div className={className} role="group" aria-labelledby={labelId}>
        {children}
      </div>
    </div>
  );
}

export function ToolPresets({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ToolGroup label={label} className="edit-panel__presets">
      {children}
    </ToolGroup>
  );
}

/** How the open tool is used, mostly the gesture on the picture the buttons do not show. */
export function ToolHint({ children }: { children: ReactNode }) {
  return <p className="edit-panel__hint">{children}</p>;
}

export function PresetButton({
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
      className={classNames("edit-panel__preset", active && "edit-panel__preset--active")}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** One preset per value, pressed while it is the current one. */
export function PresetChoices({
  label,
  values,
  current,
  format,
  disabled,
  onSelect,
}: {
  label: string;
  values: readonly number[];
  current: number;
  format: (value: number) => ReactNode;
  disabled: boolean;
  onSelect: (value: number) => void;
}) {
  return (
    <ToolPresets label={label}>
      {values.map((value) => (
        <PresetButton
          key={value}
          active={current === value}
          disabled={disabled}
          onClick={() => onSelect(value)}
        >
          {format(value)}
        </PresetButton>
      ))}
    </ToolPresets>
  );
}

export function AspectTools({
  aspectId,
  disabled,
  onSelect,
}: {
  aspectId: string;
  disabled: boolean;
  onSelect: (aspectId: string) => void;
}) {
  return (
    <ToolPresets label="Aspect">
      {CROP_ASPECTS.map((aspect) => (
        <PresetButton
          key={aspect.id}
          active={aspectId === aspect.id}
          disabled={disabled}
          onClick={() => onSelect(aspect.id)}
        >
          {aspect.label}
        </PresetButton>
      ))}
    </ToolPresets>
  );
}

/** Scale presets plus W/H fields; `step` is 2 for video, whose encoders want even sizes. */
export function SizeTools({
  scale,
  width,
  height,
  step,
  disabled,
  onScale,
  onWidth,
  onHeight,
}: {
  scale: number;
  width: number;
  height: number;
  step: number;
  disabled: boolean;
  onScale: (scale: number) => void;
  onWidth: (width: number) => void;
  onHeight: (height: number) => void;
}) {
  return (
    <>
      <PresetChoices
        label="Scale"
        values={SCALE_PRESETS}
        current={scale}
        format={formatScale}
        disabled={disabled}
        onSelect={onScale}
      />
      <ToolGroup label="Pixels" className="edit-panel__fields">
        <SizeNumberField
          label="W"
          className="edit-panel__field"
          value={width}
          min={step}
          step={step}
          disabled={disabled}
          onCommit={onWidth}
        />
        <SizeNumberField
          label="H"
          className="edit-panel__field"
          value={height}
          min={step}
          step={step}
          disabled={disabled}
          onCommit={onHeight}
        />
        <span className="edit-panel__unit" aria-hidden="true">
          px
        </span>
      </ToolGroup>
    </>
  );
}

export function BlurTools({
  masks,
  hasRegions,
  disabled,
}: {
  masks: MaskRegionControls;
  hasRegions: boolean;
  disabled: boolean;
}) {
  return (
    <>
      <ToolGroup label="Regions" className="edit-panel__tool-actions">
        <button
          type="button"
          className="edit-panel__control"
          disabled={disabled || masks.maskLimitReached}
          onClick={masks.addMask}
        >
          <Icon icon={iconPlus} />
          Add
        </button>
        <button
          type="button"
          className="edit-panel__control"
          disabled={disabled || !hasRegions}
          onClick={masks.clearMasks}
        >
          <Icon icon={iconTrash2} />
          Clear
        </button>
      </ToolGroup>
      <ToolPresets label="Blur style">
        {MASK_MODES.map((mode) => (
          <PresetButton
            key={mode.id}
            active={masks.maskMode === mode.id}
            disabled={disabled}
            onClick={() => masks.setMaskMode(mode.id)}
          >
            {mode.label}
          </PresetButton>
        ))}
      </ToolPresets>
      <ToolPresets label="Strength">
        {MASK_STRENGTHS.map((strength) => (
          <PresetButton
            key={strength.id}
            active={masks.maskStrength === strength.value}
            // A blackout has nothing to measure, so its strength would go nowhere.
            disabled={disabled || masks.maskMode === "blackout"}
            onClick={() => masks.setMaskStrength(strength.value)}
          >
            {strength.label}
          </PresetButton>
        ))}
      </ToolPresets>
    </>
  );
}

interface DraftActions {
  hasBackup: boolean;
  dirty: boolean;
  adjust: Pick<ColorAdjustControls, "autoPending">;
  resetDraft: () => void;
  apply: () => void;
}

/** Revert, Reset and Apply; the panels swap this row for their own progress while rendering. */
export function EditActions({
  edit,
  disabled,
  onRevertRequested,
}: {
  edit: DraftActions;
  disabled: boolean;
  onRevertRequested: () => void;
}) {
  return (
    <div className="edit-panel__actions">
      {edit.hasBackup && (
        <button
          type="button"
          className="edit-panel__control edit-panel__control--revert"
          disabled={disabled}
          onClick={onRevertRequested}
        >
          <Icon icon={iconUndo2} />
          Revert original
        </button>
      )}
      <button
        type="button"
        className="edit-panel__control"
        disabled={disabled || (!edit.dirty && !edit.adjust.autoPending)}
        onClick={edit.resetDraft}
      >
        Reset
      </button>
      <button
        type="button"
        className="edit-panel__apply"
        disabled={disabled || !edit.dirty || edit.adjust.autoPending}
        onClick={edit.apply}
      >
        Apply
      </button>
    </div>
  );
}
