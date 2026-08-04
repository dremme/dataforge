import type { CSSProperties } from "react";
import {
  FRAME_STEP_SECONDS,
  formatFrameTime,
  hasUsableDuration,
} from "@/features/gallery/lib/videoFrameCapture";
import { iconImageDown, iconLoader2, iconStepBack, iconStepForward } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface VideoFrameCaptureBarProps {
  duration: number;
  /** Metadata has landed, so the slider has a real range to move over. */
  ready: boolean;
  sliderTime: number;
  /** The presented frame's time where known, otherwise the scrubbed-to time. */
  displayTime: number;
  saving: boolean;
  /** Other modal work is in flight — the bar locks itself rather than racing it. */
  busy: boolean;
  onSliderTimeChange: (time: number) => void;
  onStepFrame: (direction: -1 | 1) => void;
  onSave: () => void;
}

export function VideoFrameCaptureBar({
  duration,
  ready,
  sliderTime,
  displayTime,
  saving,
  busy,
  onSliderTimeChange,
  onStepFrame,
  onSave,
}: VideoFrameCaptureBarProps) {
  const locked = !ready || busy || saving;
  const progress = ready && hasUsableDuration(duration) ? (sliderTime / duration) * 100 : 0;

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
          min={0}
          // Never let this become NaN: React would render `max="NaN"` and the
          // control's own clamping stops making sense.
          max={ready ? duration : 1}
          // A range input's arrow-key increment is its `step`, so one frame here
          // makes a focused slider nudge exactly like the buttons beside it.
          step={FRAME_STEP_SECONDS}
          value={ready ? sliderTime : 0}
          disabled={locked}
          // Firefox has ::-moz-range-progress and Chromium has no equivalent, so the
          // filled track is a gradient driven by this custom property.
          style={{ "--frame-progress": `${progress}%` } as CSSProperties}
          onChange={(event) => onSliderTimeChange(Number(event.target.value))}
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
        {!ready && <p className="video-frame-bar__hint">Frame times load with the video.</p>}
        <span className="video-frame-bar__time">
          <span className="video-frame-bar__time-current">{formatFrameTime(displayTime)}</span>
          <span className="video-frame-bar__time-divider">/</span>
          <span className="video-frame-bar__time-total">{formatFrameTime(duration)}</span>
        </span>
      </div>
    </div>
  );
}
