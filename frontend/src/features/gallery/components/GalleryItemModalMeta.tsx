import type { GalleryItem } from "@/shared/types";
import type { MediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import { formatMegapixels, formatModifiedAt } from "@/shared/lib/format";
import { Icon } from "@/shared/ui/Icon";
import { iconComfyUi } from "@/shared/brandIcons";

interface GalleryItemModalMetaProps {
  item: GalleryItem;
  resolution: MediaResolution | undefined;
  hasComfyWorkflow: boolean;
  captionCharacterCount: number;
  onInspectComfyWorkflow: () => void;
}

function MetaDivider({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="gallery-item-modal__meta-divider" aria-hidden="true" />;
}

export function GalleryItemModalMeta({
  item,
  resolution,
  hasComfyWorkflow,
  captionCharacterCount,
  onInspectComfyWorkflow,
}: GalleryItemModalMetaProps) {
  const modifiedLabel = item.modified_at ? formatModifiedAt(item.modified_at) : null;
  const hasFollowingMeta = Boolean(resolution) || hasComfyWorkflow;
  const hasMediaMeta = Boolean(modifiedLabel) || hasFollowingMeta;

  return (
    <div className="gallery-item-modal__meta" aria-label="Media details">
      {modifiedLabel && (
        <>
          <div className="gallery-item-modal__meta-item">
            <span className="gallery-item-modal__meta-value">{modifiedLabel}</span>
            <span className="gallery-item-modal__meta-label">Modified</span>
          </div>
          <MetaDivider show={hasFollowingMeta} />
        </>
      )}
      {resolution && (
        <>
          <div className="gallery-item-modal__meta-item">
            <span className="gallery-item-modal__meta-value">
              {formatMegapixels(resolution.width, resolution.height)}
            </span>
            <span className="gallery-item-modal__meta-label">Megapixels</span>
          </div>
          <span className="gallery-item-modal__meta-divider" aria-hidden="true" />
          <div className="gallery-item-modal__meta-item">
            <span className="gallery-item-modal__meta-value">
              {resolution.width.toLocaleString()}
              <span className="gallery-item-modal__meta-times">×</span>
              {resolution.height.toLocaleString()}
              <span className="gallery-item-modal__meta-unit">px</span>
            </span>
            <span className="gallery-item-modal__meta-label">Width × Height</span>
          </div>
        </>
      )}
      {hasComfyWorkflow && (
        <>
          <MetaDivider show={Boolean(resolution)} />
          <div className="gallery-item-modal__meta-item">
            <button
              type="button"
              className="gallery-item-modal__meta-badge gallery-item-modal__meta-badge--action"
              onClick={onInspectComfyWorkflow}
              title="Show the prompts in the embedded ComfyUI workflow"
            >
              <Icon icon={iconComfyUi} className="gallery-item-modal__meta-badge-icon" />
              ComfyUI
            </button>
            <span className="gallery-item-modal__meta-label">Workflow</span>
          </div>
        </>
      )}
      {!hasMediaMeta && (
        <p className="gallery-item-modal__meta-unavailable">Media details unavailable</p>
      )}
      {hasMediaMeta && <span className="gallery-item-modal__meta-divider" aria-hidden="true" />}
      <div className="gallery-item-modal__meta-item">
        <span className="gallery-item-modal__meta-value">
          {captionCharacterCount.toLocaleString()}
        </span>
        <span className="gallery-item-modal__meta-label">Characters</span>
      </div>
    </div>
  );
}
