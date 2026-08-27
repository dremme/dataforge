import type { CSSProperties } from "react";
import { iconImageDown, iconLoader2, iconStepBack, iconStepForward } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface FrameCaptureBarProps {
  min: number;
  max: number;
  step: number;
  value: number;
  ready: boolean;
  saving: boolean;
  busy: boolean;
  currentLabel: string;
  totalLabel: string;
  hint: string;
  onValueChange: (value: number) => void;
  onStepFrame: (direction: -1 | 1) => void;
  onSave: () => void;
}

export function FrameCaptureBar({
  min,
  max,
  step,
  value,
  ready,
  saving,
  busy,
  currentLabel,
  totalLabel,
  hint,
  onValueChange,
  onStepFrame,
  onSave,
}: FrameCaptureBarProps) {
  const locked = !ready || busy || saving;
  const span = max - min;
  const progress = ready && span > 0 ? ((value - min) / span) * 100 : 0;

  return (
    <div className="video-frame-bar" role="group" aria-label="Frame capture">
      <div className="video-frame-bar__scrubber">
        <button
          type="button"
          className="video-frame-bar__step"
          onClick={() => onStepFrame(-1)}
          disabled={locked}
          aria-label="Previous frame"
        >
          <Icon icon={iconStepBack} />
        </button>
        <input
          type="range"
          className="video-frame-bar__slider"
          min={min}
          // Never NaN: React renders max="NaN". A single-frame source has no span, so give a width.
          max={ready && span > 0 ? max : min + 1}
          step={step}
          value={ready ? value : min}
          disabled={locked}
          style={{ "--frame-progress": `${progress}%` } as CSSProperties}
          onChange={(event) => onValueChange(Number(event.target.value))}
          aria-label="Frame position"
        />
        <button
          type="button"
          className="video-frame-bar__step"
          onClick={() => onStepFrame(1)}
          disabled={locked}
          aria-label="Next frame"
        >
          <Icon icon={iconStepForward} />
        </button>
        <button
          type="button"
          className="video-frame-bar__save"
          onClick={onSave}
          disabled={locked}
          aria-busy={saving || undefined}
        >
          <Icon icon={saving ? iconLoader2 : iconImageDown} spin={saving} />
          {saving ? "Saving" : "Save frame"}
        </button>
      </div>

      <div className="video-frame-bar__meta">
        {!ready && <p className="video-frame-bar__hint">{hint}</p>}
        <span className="video-frame-bar__time">
          <span className="video-frame-bar__time-current">{currentLabel}</span>
          <span className="video-frame-bar__time-divider">/</span>
          <span className="video-frame-bar__time-total">{totalLabel}</span>
        </span>
      </div>
    </div>
  );
}
