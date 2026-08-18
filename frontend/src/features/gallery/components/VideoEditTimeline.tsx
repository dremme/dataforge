import { useCallback, useRef, type CSSProperties, type PointerEvent } from "react";
import { iconPause, iconPlay } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { formatFrameTime, FRAME_STEP_SECONDS } from "@/features/gallery/lib/videoFrameCapture";

/** One arrow press moves a frame; holding Shift moves a second. */
const COARSE_STEP_SECONDS = 1;

type Handle = "start" | "end";

interface VideoEditTimelineProps {
  duration: number;
  trimStart: number;
  trimEnd: number;
  playheadTime: number;
  playing: boolean;
  ready: boolean;
  disabled: boolean;
  onTrimStartChange: (seconds: number) => void;
  onTrimEndChange: (seconds: number) => void;
  onSeek: (seconds: number) => void;
  onTogglePlay: () => void;
  onSetStartAtPlayhead: () => void;
  onSetEndAtPlayhead: () => void;
}

/**
 * The in/out band over the source's full length.
 *
 * A custom track rather than two overlaid range inputs: overlaid thumbs need
 * pointer-events gymnastics to decide which one a click belongs to, cannot paint a
 * filled band between themselves without a third element anyway, and cannot be styled
 * apart. The handles carry `role="slider"` so the keyboard path is the real one.
 */
export function VideoEditTimeline({
  duration,
  trimStart,
  trimEnd,
  playheadTime,
  playing,
  ready,
  disabled,
  onTrimStartChange,
  onTrimEndChange,
  onSeek,
  onTogglePlay,
  onSetStartAtPlayhead,
  onSetEndAtPlayhead,
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
      event.preventDefault();
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
        <div className="video-edit-timeline__selection" />
        <div className="video-edit-timeline__playhead" />
        <button
          type="button"
          className="video-edit-timeline__handle video-edit-timeline__handle--start"
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={ready ? duration : 0}
          aria-valuenow={trimStart}
          aria-valuetext={formatFrameTime(trimStart)}
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
          aria-valuemax={ready ? duration : 0}
          aria-valuenow={trimEnd}
          aria-valuetext={formatFrameTime(trimEnd)}
          disabled={locked}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove("end")}
          onKeyDown={handleKeyDown("end", trimEnd)}
        />
      </div>

      <div className="video-edit-timeline__set">
        <button type="button" onClick={onSetStartAtPlayhead} disabled={locked}>
          Set in
        </button>
        <button type="button" onClick={onSetEndAtPlayhead} disabled={locked}>
          Set out
        </button>
      </div>

      <span className="video-edit-timeline__times">
        <span className="video-edit-timeline__time-current">{formatFrameTime(trimStart)}</span>
        <span className="video-edit-timeline__time-divider">-</span>
        <span className="video-edit-timeline__time-current">{formatFrameTime(trimEnd)}</span>
        <span className="video-edit-timeline__time-total">
          of {ready ? formatFrameTime(duration) : "--"}
        </span>
      </span>
    </div>
  );
}
