import type { CSSProperties } from "react";
import { iconImageDown, iconLoader2, iconStepBack, iconStepForward } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface FrameCaptureBarProps {
  min: number;
  max: number;
  /** The slider's arrow-key increment: one frame, however the format counts them. */
  step: number;
  value: number;
  /** The source is loaded, so the slider has a real range to move over. */
  ready: boolean;
  saving: boolean;
  /** Other modal work is in flight — the bar locks itself rather than racing it. */
  busy: boolean;
  /** The position on screen: a timestamp for video, a frame ordinal for a GIF. */
  currentLabel: string;
  totalLabel: string;
  /** Shown while the source is still loading. */
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
          // Never let this become NaN: React would render `max="NaN"` and the
          // control's own clamping stops making sense. A single-frame source has
          // no span either, so the track needs a width it can still paint.
          max={ready && span > 0 ? max : min + 1}
          step={step}
          value={ready ? value : min}
          disabled={locked}
          // Firefox has ::-moz-range-progress and Chromium has no equivalent, so the
          // filled track is a gradient driven by this custom property.
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
