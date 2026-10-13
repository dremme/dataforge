import { iconLoader2, iconX } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { useVideoExports } from "@/features/videoEditor/hooks/useVideoExports";

interface VideoExportTrackerProps {
  /** The editor shows its own exports; the tracker covers the time spent outside it. */
  hidden: boolean;
  onOpen: (path: string) => void;
}

/** Exports keep running after the editor closes; this keeps them in sight from the gallery. */
export function VideoExportTracker({ hidden, onOpen }: VideoExportTrackerProps) {
  const { exports, cancel, dismiss } = useVideoExports();
  if (hidden || exports.length === 0) return null;
  return (
    <div className="video-export-tracker" aria-label="Video exports">
      {exports.slice(0, 3).map((item) => (
        <div
          key={item.id}
          className={classNames(
            "video-export-tracker__item",
            `video-export-tracker__item--${item.status}`,
          )}
          role="status"
        >
          <span className="video-export-tracker__text">
            {item.status === "running" && (
              <>
                <Icon icon={iconLoader2} spin /> Exporting {item.output_name} ·{" "}
                {Math.round(item.progress * 100)}%
              </>
            )}
            {item.status === "completed" && <>Exported {item.output_name}</>}
            {item.status === "failed" && (
              <>
                Export of {item.output_name} failed: {item.error}
              </>
            )}
            {item.status === "cancelled" && <>Export of {item.output_name} cancelled</>}
          </span>
          {item.status === "running" && (
            <span className="video-export-tracker__bar" aria-hidden="true">
              <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
            </span>
          )}
          <span className="video-export-tracker__actions">
            {item.status === "running" && (
              <button
                type="button"
                className="video-export-tracker__btn"
                onClick={() => void cancel(item.id)}
              >
                Cancel
              </button>
            )}
            {item.status === "completed" && (
              <button
                type="button"
                className="video-export-tracker__btn"
                onClick={() => onOpen(item.output_path)}
              >
                Open
              </button>
            )}
            {item.status !== "running" && (
              <button
                type="button"
                className="video-export-tracker__btn"
                aria-label={`Dismiss ${item.output_name}`}
                onClick={() => void dismiss(item.id)}
              >
                <Icon icon={iconX} />
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
