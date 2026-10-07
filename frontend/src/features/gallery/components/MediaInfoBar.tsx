import type { GalleryItem } from "@/shared/types";
import type { MediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import { formatAspectRatio } from "@/features/gallery/lib/aspectRatio";
import { formatCount, formatMegapixels, formatModifiedAt } from "@/shared/lib/format";
import { Icon } from "@/shared/ui/Icon";
import { iconComfyUi } from "@/shared/brandIcons";
import { classNames } from "@/shared/lib/classNames";

interface MediaInfoBarProps {
  item: GalleryItem;
  resolution: MediaResolution | undefined;
  hasComfyWorkflow?: boolean;
  onInspectComfyWorkflow?: () => void;
  className?: string;
  role?: "group";
}

function MetaDivider({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="media-info__divider" aria-hidden="true" />;
}

export function MediaInfoBar({
  item,
  resolution,
  hasComfyWorkflow,
  onInspectComfyWorkflow,
  className,
  role,
}: MediaInfoBarProps) {
  const modifiedLabel = item.modified_at ? formatModifiedAt(item.modified_at) : null;
  const showWorkflow = Boolean(hasComfyWorkflow && onInspectComfyWorkflow);
  const hasFollowingMeta = Boolean(resolution) || showWorkflow;
  const hasMediaMeta = Boolean(modifiedLabel) || hasFollowingMeta;

  return (
    <div className={classNames("media-info", className)} role={role} aria-label="Media details">
      {modifiedLabel && (
        <>
          <div className="media-info__item">
            <span className="media-info__value">{modifiedLabel}</span>
            <span className="media-info__label">Modified</span>
          </div>
          <MetaDivider show={hasFollowingMeta} />
        </>
      )}
      {resolution && (
        <>
          <div className="media-info__item">
            <span className="media-info__value">
              {formatMegapixels(resolution.width, resolution.height)}
            </span>
            <span className="media-info__label">Megapixels</span>
          </div>
          <span className="media-info__divider" aria-hidden="true" />
          <div className="media-info__item">
            <span className="media-info__value">
              {formatCount(resolution.width)}
              <span className="media-info__times">×</span>
              {formatCount(resolution.height)}
              <span className="media-info__unit">px</span>
            </span>
            <span className="media-info__label">Width × Height</span>
          </div>
          <span className="media-info__divider" aria-hidden="true" />
          <div className="media-info__item">
            <span className="media-info__value">
              {formatAspectRatio(resolution.width, resolution.height)}
            </span>
            <span className="media-info__label">Aspect ratio</span>
          </div>
        </>
      )}
      {showWorkflow && (
        <>
          <MetaDivider show={Boolean(resolution)} />
          <div className="media-info__item">
            <button
              type="button"
              className="media-info__badge media-info__badge--action"
              onClick={onInspectComfyWorkflow}
              title="Inspect the embedded ComfyUI workflow"
            >
              <Icon icon={iconComfyUi} className="media-info__badge-icon" />
              ComfyUI
            </button>
            <span className="media-info__label">Workflow</span>
          </div>
        </>
      )}
      {!hasMediaMeta && <p className="media-info__unavailable">Media details unavailable</p>}
    </div>
  );
}
