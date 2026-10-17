import type { VideoProjectEasing } from "@/shared/types";
import { iconChevronLeft, iconChevronRight, iconDiamond } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import {
  clipValueAt,
  EASINGS,
  keyframeAt,
  keyframeTimes,
  setKeyframeEasing,
  setValueAt,
  toggleKeyframe,
  type AnimatedProperty,
} from "@/features/videoEditor/lib/keyframes";
import { clipEnd, type Clip } from "@/features/videoEditor/lib/timeline";
import { Slider, type ClipEdit } from "./InspectorParts";

/** Keyframes are set on the clip, so a playhead before or after it keys the nearest end. */
function timeOnClip(clip: Clip, time: number): number {
  return Math.min(Math.max(time, clip.start), clipEnd(clip));
}

function keyPatch(clip: Clip): Partial<Clip> {
  return { keyframes: clip.keyframes, transform: clip.transform, gain: clip.gain };
}

interface KeyedSliderProps {
  clip: Clip;
  property: AnimatedProperty;
  time: number;
  label: string;
  min: number;
  max: number;
  step: number;
  resting: number;
  format: (value: number) => string;
  onEdit: ClipEdit;
}

/**
 * A slider for a property that can be animated. It shows the value at the playhead; once the
 * property has a keyframe, moving it keys the playhead instead of the static value.
 */
export function KeyedSlider({ clip, property, time, label, onEdit, ...slider }: KeyedSliderProps) {
  const at = timeOnClip(clip, time);
  const animated = clip.keyframes[property].length > 0;
  const onKey = keyframeAt(clip, property, at) !== undefined;
  const action = onKey ? `Remove the keyframe for ${label}` : `Add a keyframe for ${label}`;
  return (
    <div className="video-editor__keyed">
      <Slider
        label={label}
        value={clipValueAt(clip, property, at)}
        onChange={(value, final) => onEdit(setValueAt(clip, property, at, value), final)}
        {...slider}
      />
      <button
        type="button"
        className={classNames(
          "video-editor__key-btn",
          animated && "video-editor__key-btn--animated",
          onKey && "video-editor__key-btn--on",
        )}
        aria-pressed={onKey}
        aria-label={action}
        title={action}
        onClick={() => onEdit(keyPatch(toggleKeyframe(clip, property, at)), true)}
      >
        <Icon icon={iconDiamond} />
      </button>
    </div>
  );
}

/** Steps the playhead between a panel's keyframes and shapes the ones under it. */
export function KeyframeBar({
  clip,
  properties,
  time,
  onEdit,
  onSeek,
}: {
  clip: Clip;
  properties: readonly AnimatedProperty[];
  time: number;
  onEdit: ClipEdit;
  onSeek: (time: number) => void;
}) {
  const times = keyframeTimes(clip, properties);
  if (times.length === 0) return null;
  const at = timeOnClip(clip, time);
  const tolerance = 1e-3;
  const previous = times.filter((key) => key < time - tolerance).at(-1);
  const next = times.find((key) => key > time + tolerance);
  const here = properties.filter((property) => keyframeAt(clip, property, at));
  const easing = here.length ? keyframeAt(clip, here[0], at)?.easing : undefined;
  const setEasing = (value: VideoProjectEasing) => {
    let changed = clip;
    for (const property of here) changed = setKeyframeEasing(changed, property, at, value);
    onEdit({ keyframes: changed.keyframes }, true);
  };
  return (
    <div className="video-editor__keyframe-bar">
      <button
        type="button"
        className="video-editor__icon-btn"
        aria-label="Previous keyframe"
        title="Previous keyframe"
        disabled={previous === undefined}
        onClick={() => previous !== undefined && onSeek(previous)}
      >
        <Icon icon={iconChevronLeft} />
      </button>
      <select
        aria-label="Easing to the next keyframe"
        title="How the keyframes here travel to the next ones"
        className="video-editor__easing-select"
        value={easing ?? ""}
        disabled={!easing}
        onChange={(event) => setEasing(event.target.value as VideoProjectEasing)}
      >
        {!easing && <option value="">No keyframe at the playhead</option>}
        {EASINGS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="video-editor__icon-btn"
        aria-label="Next keyframe"
        title="Next keyframe"
        disabled={next === undefined}
        onClick={() => next !== undefined && onSeek(next)}
      >
        <Icon icon={iconChevronRight} />
      </button>
    </div>
  );
}
