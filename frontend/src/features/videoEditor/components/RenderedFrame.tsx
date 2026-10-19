import { Tooltip } from "@/shared/ui/Tooltip";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

export interface RenderedFrameState {
  url: string;
  timecode: string;
  width: number;
  height: number;
}

/** The export renderer's own picture of one frame, laid over the live preview until closed. */
export function RenderedFrame({
  frame,
  onClose,
}: {
  frame: RenderedFrameState;
  onClose: () => void;
}) {
  return (
    <>
      <img
        className="video-editor__rendered-frame"
        src={frame.url}
        alt={`Export render at ${frame.timecode}`}
      />
      <span className="video-editor__rendered-bar" role="status">
        <span>
          Export render · {frame.timecode} · {frame.width} × {frame.height}
        </span>
        <Tooltip content="Opens the frame at its full size in a new tab">
          <a className="video-editor__link-btn" href={frame.url} target="_blank" rel="noreferrer">
            Full size
          </a>
        </Tooltip>
        <Tooltip content="Back to the live preview">
          <button
            type="button"
            className="video-editor__icon-btn"
            aria-label="Back to the live preview"
            onClick={onClose}
          >
            <Icon icon={iconX} />
          </button>
        </Tooltip>
      </span>
    </>
  );
}
