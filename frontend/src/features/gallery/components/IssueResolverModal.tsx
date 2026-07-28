import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { saveCaption } from "@/features/gallery/api/captions";
import { mediaUrl, openMediaInViewer } from "@/features/gallery/api/media";
import { formatApiError } from "@/shared/api/http";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { useGalleryItemCaption } from "@/features/gallery/hooks/useGalleryItemCaption";
import { useMediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { isVideo } from "@/features/gallery/lib/itemKind";
import {
  collectAdjacentModalMediaTargets,
  schedulePrefetchModalMedia,
} from "@/features/gallery/lib/modalMediaPrefetch";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { formatMegapixels } from "@/shared/lib/format";
import {
  iconArrowUpRight,
  iconLightbulb,
  iconLoader2,
  iconTriangleAlert,
  iconX,
} from "@/shared/icons";
import { CaptionEditor } from "@/shared/ui/CaptionEditor";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ZoomableImage } from "./ZoomableImage";

interface IssueResolverModalProps {
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onCaptionSaved: (path: string, update: CaptionSaveResponse) => void;
}

export function IssueResolverModal({
  items,
  index,
  onClose,
  onIndexChange,
  onCaptionSaved,
}: IssueResolverModalProps) {
  const [queue] = useState(() => items);
  const item = queue[index];
  const { recordResolution, getResolution } = useMediaResolution();
  const backdropClass = useOverlayBackdropClass("issue-resolver-modal__backdrop");
  useScrollLock(true, "gallery-item-modal-open");

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<boolean>(false);
  const [openingInViewer, setOpeningInViewer] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const { caption, handleCaptionChange } = useGalleryItemCaption({
    item,
    onCaptionSaved,
    autoSave: false,
  });

  useEffect(() => {
    setSaveError(false);
    setSaving(false);
    setOpeningInViewer(false);
    setViewerError(null);
  }, [item?.path]);

  // Warm the next queue item only (forward flow). Idle + low priority so the
  // current stage media is not starved.
  useEffect(() => {
    return schedulePrefetchModalMedia(
      collectAdjacentModalMediaTargets(queue, index, { offsets: [1] }),
    );
  }, [index, queue]);

  const closeModal = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  const handleNext = useCallback(() => {
    if (saving) return;
    if (index < queue.length - 1) onIndexChange(index + 1);
  }, [index, onIndexChange, queue.length, saving]);

  const handleOpenInViewer = useCallback(async () => {
    if (!item || openingInViewer || saving) return;

    setViewerError(null);
    setOpeningInViewer(true);

    try {
      await openMediaInViewer(item.path);
    } catch (error) {
      setViewerError(formatApiError(error));
    } finally {
      setOpeningInViewer(false);
    }
  }, [item, openingInViewer, saving]);

  const handleResolve = useCallback(async () => {
    if (!item || saving) return;

    setSaving(true);
    setSaveError(false);

    try {
      const result = await saveCaption(item.path, caption.trim(), undefined, {
        resolveIssue: true,
      });
      onCaptionSaved(item.path, result);

      if (index < queue.length - 1) {
        onIndexChange(index + 1);
      } else {
        onClose();
      }
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [caption, index, item, onCaptionSaved, onClose, onIndexChange, queue.length, saving]);

  useEscapeKey(closeModal, !saving);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (saving || isEditableTarget(event.target)) return;

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void handleResolve();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleResolve, saving]);

  if (!item) return null;

  const itemIsVideo = isVideo(item);
  const mediaLabel = itemIsVideo ? "video" : "image";
  const captionDisplay = getGalleryItemCaptionDisplay(item, mediaLabel);
  const resolution = getResolution(item);
  const placeholder =
    captionDisplay.variant === "success" ? "Add a caption..." : captionDisplay.message;
  const issueText = item.issue?.trim() || "Error in issue file";
  const suggestionText = item.issue_suggestions?.trim() || null;

  return createPortal(
    <div
      ref={modalRef}
      className="issue-resolver-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Resolve caption issue for ${item.name}`}
    >
      <button
        type="button"
        className={backdropClass}
        onClick={closeModal}
        aria-label="Close"
        disabled={saving}
        tabIndex={-1}
      />

      <div className="issue-resolver-modal__panel">
        <header className="issue-resolver-modal__header">
          <div className="issue-resolver-modal__header-text">
            <h2 className="issue-resolver-modal__title">Resolve caption issues</h2>
            <span className="issue-resolver-modal__counter">
              {index + 1} / {queue.length}
            </span>
          </div>
          <div className="issue-resolver-modal__header-actions">
            {!itemIsVideo && (
              <Tooltip content={viewerError ?? "Open in image preview"}>
                <button
                  type="button"
                  className="issue-resolver-modal__preview"
                  onClick={() => {
                    void handleOpenInViewer();
                  }}
                  disabled={openingInViewer || saving}
                  aria-label="Open in image preview"
                >
                  <Icon
                    icon={openingInViewer ? iconLoader2 : iconArrowUpRight}
                    spin={openingInViewer}
                  />
                </button>
              </Tooltip>
            )}
            <button
              type="button"
              className="issue-resolver-modal__close"
              onClick={closeModal}
              disabled={saving}
              aria-label="Close"
            >
              <Icon icon={iconX} />
            </button>
          </div>
        </header>

        <div className="issue-resolver-modal__body">
          <div className="issue-resolver-modal__stage">
            {itemIsVideo ? (
              <video
                key={item.path}
                className="issue-resolver-modal__video"
                src={mediaUrl(item.path)}
                controls
                muted
                playsInline
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  recordResolution(video.videoWidth, video.videoHeight, item.path);
                }}
              />
            ) : (
              <ZoomableImage
                key={item.path}
                className="issue-resolver-modal__media-wrap"
                imgClassName="issue-resolver-modal__img"
                src={mediaUrl(item.path)}
                alt={item.name}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  recordResolution(img.naturalWidth, img.naturalHeight, item.path);
                }}
              />
            )}
          </div>

          <div className="issue-resolver-modal__details">
            <p className="issue-resolver-modal__file-name" title={item.name}>
              {item.name}
            </p>
            {resolution && (
              <div className="issue-resolver-modal__meta">
                <div className="issue-resolver-modal__meta-value">
                  {formatMegapixels(resolution.width, resolution.height)}
                </div>
                <span className="issue-resolver-modal__meta-divider" aria-hidden="true" />
                <div className="issue-resolver-modal__meta-value">
                  {resolution.width} × {resolution.height}
                </div>
              </div>
            )}

            <div className="issue-resolver-modal__issue-card">
              <div className="issue-resolver-modal__issue-row">
                <Icon icon={iconTriangleAlert} className="issue-resolver-modal__issue-icon" />
                <div className="issue-resolver-modal__issue-content">
                  <span className="issue-resolver-modal__issue-label">Issue</span>
                  <p className="issue-resolver-modal__issue-text">{issueText}</p>
                </div>
              </div>

              {suggestionText && (
                <div className="issue-resolver-modal__issue-row issue-resolver-modal__issue-row--suggestion">
                  <Icon icon={iconLightbulb} className="issue-resolver-modal__issue-icon" />
                  <div className="issue-resolver-modal__issue-content">
                    <span className="issue-resolver-modal__issue-label">Suggestion</span>
                    <p className="issue-resolver-modal__issue-text">{suggestionText}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="issue-resolver-modal__caption-editor">
              <label
                htmlFor="issue-resolver-caption"
                className="issue-resolver-modal__caption-label"
              >
                Caption
              </label>
              <CaptionEditor
                id="issue-resolver-caption"
                value={caption}
                placeholder={placeholder}
                variant={captionDisplay.variant}
                saveState={saveError ? "error" : "idle"}
                aria-label={`Caption for ${item.name}`}
                aria-invalid={saveError}
                title={saveError ? "Save failed" : undefined}
                editable={!saving}
                onChange={handleCaptionChange}
              />
            </div>
          </div>
        </div>

        <footer className="issue-resolver-modal__footer">
          <button
            type="button"
            className="issue-resolver-modal__btn issue-resolver-modal__btn--secondary"
            onClick={handleNext}
            disabled={saving || index === queue.length - 1}
          >
            Skip
          </button>
          <button
            type="button"
            className="issue-resolver-modal__btn issue-resolver-modal__btn--primary"
            onClick={() => {
              void handleResolve();
            }}
            disabled={saving}
            aria-busy={saving || undefined}
          >
            {saving ? (
              <>
                <Icon
                  icon={iconLoader2}
                  className="issue-resolver-modal__btn-icon issue-resolver-modal__btn-icon--spin"
                />
                Resolving...
              </>
            ) : (
              "Resolve"
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
