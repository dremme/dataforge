import type { GalleryItem } from "@/shared/types";
import type { MediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import { captionFileTypeLabel } from "@/shared/lib/captionSidecar";
import { formatFps, formatMegapixels, formatModifiedAt } from "@/shared/lib/format";

interface GalleryItemModalMetaProps {
  item: GalleryItem;
  itemIsVideo: boolean;
  resolution: MediaResolution | undefined;
  hasComfyWorkflow: boolean;
  captionCharacterCount: number;
}

function MetaDivider({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="gallery-item-modal__meta-divider" aria-hidden="true" />;
}

export function GalleryItemModalMeta({
  item,
  itemIsVideo,
  resolution,
  hasComfyWorkflow,
  captionCharacterCount,
}: GalleryItemModalMetaProps) {
  const modifiedLabel = item.modified_at ? formatModifiedAt(item.modified_at) : null;
  const hasVideoStats = itemIsVideo && (item.frame_count != null || item.fps != null);
  const jsonCaptionLabel =
    item.caption_file_type === "json" ? captionFileTypeLabel(item.caption_file_type) : null;
  const hasFollowingMeta =
    Boolean(resolution) || jsonCaptionLabel != null || hasVideoStats || hasComfyWorkflow;
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
      {itemIsVideo && item.frame_count != null && (
        <>
          <MetaDivider show={Boolean(resolution)} />
          <div className="gallery-item-modal__meta-item">
            <span className="gallery-item-modal__meta-value">
              {item.frame_count.toLocaleString()}
            </span>
            <span className="gallery-item-modal__meta-label">Frames</span>
          </div>
        </>
      )}
      {itemIsVideo && item.fps != null && (
        <>
          <MetaDivider show={Boolean(resolution || item.frame_count != null)} />
          <div className="gallery-item-modal__meta-item">
            <span className="gallery-item-modal__meta-value">{formatFps(item.fps)}</span>
            <span className="gallery-item-modal__meta-label">fps</span>
          </div>
        </>
      )}
      {hasComfyWorkflow && (
        <>
          <MetaDivider show={Boolean(resolution || hasVideoStats) || jsonCaptionLabel != null} />
          <div className="gallery-item-modal__meta-item">
            <span className="gallery-item-modal__meta-badge" title="Embedded ComfyUI workflow">
              ComfyUI
            </span>
            <span className="gallery-item-modal__meta-label">Workflow</span>
          </div>
        </>
      )}
      {jsonCaptionLabel && (
        <>
          <MetaDivider show={Boolean(resolution || hasVideoStats)} />
          <div className="gallery-item-modal__meta-item">
            <span className="gallery-item-modal__meta-badge" title={`${jsonCaptionLabel} caption`}>
              {jsonCaptionLabel}
            </span>
            <span className="gallery-item-modal__meta-label">Caption</span>
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
