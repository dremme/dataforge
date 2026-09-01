import { useCallback, useRef, type CSSProperties, type PointerEvent } from "react";
import { iconPause, iconPlay, iconVolume2, iconVolumeX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { formatFrameTime, FRAME_STEP_SECONDS } from "@/features/gallery/lib/videoFrameCapture";
import { outputTime } from "@/features/gallery/lib/videoEdit";

const COARSE_STEP_SECONDS = 1;

type Handle = "start" | "end";

interface VideoEditTimelineProps {
  duration: number;
  trimStart: number;
  trimEnd: number;
  /** Retime factor, for the readouts only — every trim value here stays in source seconds. */
  speed: number;
  playheadTime: number;
  playing: boolean;
  muted: boolean;
  ready: boolean;
  disabled: boolean;
  onTrimStartChange: (seconds: number) => void;
  onTrimEndChange: (seconds: number) => void;
  onSeek: (seconds: number) => void;
  onTogglePlay: () => void;
  onToggleMuted: () => void;
}

export function VideoEditTimeline({
  duration,
  trimStart,
  trimEnd,
  speed,
  playheadTime,
  playing,
  muted,
  ready,
  disabled,
  onTrimStartChange,
  onTrimEndChange,
  onSeek,
  onTogglePlay,
  onToggleMuted,
}: VideoEditTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const locked = !ready || disabled;
  const span = ready && duration > 0 ? duration : 1;

  const secondsAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return 0;
      const bounds = track.getBoundingClientRect();
      if (bounds.width <= 0) return 0;
      const fraction = (clientX - bounds.left) / bounds.width;
      return Math.min(duration, Math.max(0, fraction * duration));
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (locked) return;
      // preventDefault kills drag-selection and focus; the handle must take it or arrows navigate.
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [locked],
  );

  const handlePointerMove = useCallback(
    (handle: Handle) => (event: PointerEvent<HTMLButtonElement>) => {
      if (locked || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const seconds = secondsAt(event.clientX);
      if (handle === "start") {
        onTrimStartChange(seconds);
      } else {
        onTrimEndChange(seconds);
      }
    },
    [locked, onTrimEndChange, onTrimStartChange, secondsAt],
  );

  const handleKeyDown = useCallback(
    (handle: Handle, value: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (locked) return;
      const step = event.shiftKey ? COARSE_STEP_SECONDS : FRAME_STEP_SECONDS;
      const change = handle === "start" ? onTrimStartChange : onTrimEndChange;

      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        change(value - step);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        change(value + step);
      } else if (event.key === "Home") {
        change(0);
      } else if (event.key === "End") {
        change(duration);
      } else {
        return;
      }
      event.preventDefault();
    },
    [duration, locked, onTrimEndChange, onTrimStartChange],
  );

  const handleTrackPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (locked || event.target !== event.currentTarget) return;
      onSeek(secondsAt(event.clientX));
    },
    [locked, onSeek, secondsAt],
  );

  const percent = (seconds: number) => `${(Math.min(seconds, span) / span) * 100}%`;

  return (
    <div className="video-edit-timeline">
      <button
        type="button"
        className="video-edit-timeline__play"
        onClick={onTogglePlay}
        disabled={locked}
        aria-label={playing ? "Pause preview" : "Play preview"}
      >
        <Icon icon={playing ? iconPause : iconPlay} />
      </button>

      <button
        type="button"
        className="video-edit-timeline__mute"
        onClick={onToggleMuted}
        aria-label={muted ? "Unmute preview" : "Mute preview"}
      >
        <Icon icon={muted ? iconVolumeX : iconVolume2} />
      </button>

      <div
        ref={trackRef}
        className="video-edit-timeline__track"
        style={
          {
            "--trim-start": percent(trimStart),
            "--trim-end": percent(trimEnd),
            "--playhead": percent(playheadTime),
          } as CSSProperties
        }
        onPointerDown={handleTrackPointerDown}
        role="group"
        aria-label="Trim range"
      >
        <div className="video-edit-timeline__dropped video-edit-timeline__dropped--head" />
        <div className="video-edit-timeline__dropped video-edit-timeline__dropped--tail" />
        <div className="video-edit-timeline__selection" />
        <div className="video-edit-timeline__playhead" />
        <button
          type="button"
          className="video-edit-timeline__handle video-edit-timeline__handle--start"
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={ready ? outputTime(duration, speed) : 0}
          aria-valuenow={outputTime(trimStart, speed)}
          aria-valuetext={formatFrameTime(outputTime(trimStart, speed))}
          disabled={locked}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove("start")}
          onKeyDown={handleKeyDown("start", trimStart)}
        />
        <button
          type="button"
          className="video-edit-timeline__handle video-edit-timeline__handle--end"
          role="slider"
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={ready ? outputTime(duration, speed) : 0}
          aria-valuenow={outputTime(trimEnd, speed)}
          aria-valuetext={formatFrameTime(outputTime(trimEnd, speed))}
          disabled={locked}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove("end")}
          onKeyDown={handleKeyDown("end", trimEnd)}
        />
      </div>

      <span className="video-edit-timeline__times">
        <span className="video-edit-timeline__span">
          {formatFrameTime(outputTime(trimStart, speed))} -{" "}
          {formatFrameTime(outputTime(trimEnd, speed))}
        </span>
        <span className="video-edit-timeline__total">
          of {ready ? formatFrameTime(outputTime(duration, speed)) : "--"}
        </span>
      </span>
    </div>
  );
}
