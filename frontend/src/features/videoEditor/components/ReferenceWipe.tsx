import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

export interface ReferenceFrame {
  /** The monitor's picture when it was held, as a data URL. */
  url: string;
  timecode: string;
}

/**
 * A held frame over the live monitor, left of a divider that can be dragged across: compare a
 * shot against another one, or against itself before a change.
 */
export function ReferenceWipe({
  reference,
  onClear,
}: {
  reference: ReferenceFrame;
  onClear: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);

  const follow = (event: ReactPointerEvent) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    setSplit(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  };
  return (
    <div ref={boxRef} className="video-editor__reference" aria-label="Reference comparison">
      <img
        className="video-editor__reference-picture"
        src={reference.url}
        alt=""
        style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
        draggable={false}
      />
      <span
        className="video-editor__reference-divider"
        style={{ left: `${split * 100}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Reference divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
        }}
        onPointerMove={(event) => dragging.current && follow(event)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" ? -0.05 : event.key === "ArrowRight" ? 0.05 : 0;
          if (!step) return;
          // Arrow keys move the divider here, not the playhead.
          event.preventDefault();
          event.stopPropagation();
          setSplit((value) => Math.min(1, Math.max(0, value + step)));
        }}
      />
      <span className="video-editor__reference-tag video-editor__reference-tag--held">
        Reference {reference.timecode}
        <button type="button" aria-label="Stop comparing" title="Stop comparing" onClick={onClear}>
          <Icon icon={iconX} />
        </button>
      </span>
      <span className="video-editor__reference-tag video-editor__reference-tag--live">Live</span>
    </div>
  );
}
