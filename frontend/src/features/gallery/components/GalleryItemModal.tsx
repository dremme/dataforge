import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { deleteMedia, mediaUrl, openMediaInViewer } from "@/features/gallery/api/media";
import { formatApiError } from "@/shared/api/http";
import { useComfyWorkflowFlag } from "@/features/gallery/hooks/useComfyWorkflowFlag";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import { useGalleryItemCaption } from "@/features/gallery/hooks/useGalleryItemCaption";
import { useMediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import {
  iconArrowUpRight,
  iconBraces,
  iconChevronLeft,
  iconChevronRight,
  iconCopy,
  iconLoader2,
  iconTrash2,
  iconX,
} from "@/shared/icons";
import { isVideo } from "@/features/gallery/lib/itemKind";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { BboxOverlay } from "./BboxOverlay";
import { CaptionEditor } from "@/shared/ui/CaptionEditor";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { GalleryItemModalBboxList } from "./GalleryItemModalBboxList";
import { GalleryItemModalMeta } from "./GalleryItemModalMeta";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ZoomableImage } from "./ZoomableImage";

const GalleryItemJsonEditorModal = lazy(() =>
  import("./GalleryItemJsonEditorModal").then((module) => ({
    default: module.GalleryItemJsonEditorModal,
  })),
);

interface GalleryItemModalProps {
  items: GalleryItem[];
  index: number;
  /** Active gallery toolbar search — highlighted in the caption field. */
  searchQuery?: string;
  searchRegex?: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onCaptionSaved: (path: string, update: CaptionSaveResponse) => void;
  onDeleted?: (path: string) => void;
  onJsonEditorOpenChange?: (open: boolean) => void;
}

export function GalleryItemModal({
  items,
  index,
  searchQuery = "",
  searchRegex = false,
  onClose,
  onPrevious,
  onNext,
  onCaptionSaved,
  onDeleted,
  onJsonEditorOpenChange,
}: GalleryItemModalProps) {
  const item = items[index];
  const { recordResolution, getResolution } = useMediaResolution();
  const hasComfyWorkflow = useComfyWorkflowFlag(item?.path);

  const {
    caption,
    bboxes,
    selectedBboxIndex,
    setSelectedBboxIndex,
    captionContent,
    hasJsonCaption,
    bboxesEditable,
    saveState,
    saveError,
    handleCaptionChange,
    handleBboxesChange,
    handleJsonContentSave,
    jsonSaveState,
    jsonSaveError,
    resetJsonSaveState,
    flushPendingSave,
  } = useGalleryItemCaption({ item, onCaptionSaved });

  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonEditorSession, setJsonEditorSession] = useState(0);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openingInViewer, setOpeningInViewer] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const childOverlayOpen = deleteConfirmOpen || jsonEditorOpen;
  useFocusTrap(modalRef, !childOverlayOpen);

  const jsonEditorContent = useMemo(
    () => (captionContent ? captionContent.trimEnd() : null),
    [captionContent],
  );

  useEffect(() => {
    setJsonEditorOpen(false);
    setJsonEditorSession(0);
    setDeleteConfirmOpen(false);
    setDeleting(false);
    setOpeningInViewer(false);
    setViewerError(null);
    resetJsonSaveState();
  }, [item?.path, resetJsonSaveState]);

  useEffect(() => {
    onJsonEditorOpenChange?.(jsonEditorOpen);
  }, [jsonEditorOpen, onJsonEditorOpenChange]);

  useEffect(() => {
    return () => {
      onJsonEditorOpenChange?.(false);
    };
  }, [onJsonEditorOpenChange]);

  const openJsonEditor = useCallback(() => {
    resetJsonSaveState();
    setJsonEditorSession((session) => session + 1);
    setJsonEditorOpen(true);
  }, [resetJsonSaveState]);

  const closeJsonEditor = useCallback(() => {
    if (jsonSaveState === "saving") return;
    resetJsonSaveState();
    setJsonEditorOpen(false);
  }, [jsonSaveState, resetJsonSaveState]);

  const saveJsonEditor = useCallback(
    (jsonContent: string) => {
      void handleJsonContentSave(jsonContent).then((saved) => {
        if (saved) {
          setJsonEditorOpen(false);
        }
      });
    },
    [handleJsonContentSave],
  );

  const { copyState, copyLabel, copyText } = useCopyFeedback();

  const closeModal = useCallback(() => {
    if (deleting) return;
    flushPendingSave();
    onClose();
  }, [deleting, flushPendingSave, onClose]);

  const openDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(true);
  }, [deleting]);

  const cancelDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
  }, [deleting]);

  const handleOpenInViewer = useCallback(async () => {
    if (!item || openingInViewer) return;

    setViewerError(null);
    setOpeningInViewer(true);

    try {
      await openMediaInViewer(item.path);
    } catch (error) {
      setViewerError(formatApiError(error));
    } finally {
      setOpeningInViewer(false);
    }
  }, [item, openingInViewer]);

  const confirmDelete = useCallback(async () => {
    if (!item || deleting) return;

    setDeleting(true);
    flushPendingSave();

    try {
      await deleteMedia(item.path);
      setDeleteConfirmOpen(false);
      onDeleted?.(item.path);
    } catch {
      setDeleteConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }, [deleting, flushPendingSave, item, onDeleted]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest(".cm-content") != null));

      if (event.key === "Escape") {
        if (jsonEditorOpen || deleteConfirmOpen) return;
        closeModal();
      }
      if (isEditing) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [closeModal, deleteConfirmOpen, jsonEditorOpen, onPrevious, onNext]);

  if (!item) return null;

  const itemIsVideo = isVideo(item);
  const mediaLabel = itemIsVideo ? "video" : "image";
  const resolution = getResolution(item);
  const captionDisplay = getGalleryItemCaptionDisplay(item, mediaLabel);
  const captionCharacterCount = caption.length;
  const copyContent = hasJsonCaption ? (captionContent ?? "") : caption;
  const canCopyCaption = copyContent.length > 0;
  const canEditJson = hasJsonCaption && (jsonEditorContent?.length ?? 0) > 0;
  const placeholder =
    captionDisplay.variant === "success" ? "Add a caption..." : captionDisplay.message;

  return createPortal(
    <>
      <div
        ref={modalRef}
        className="gallery-item-modal"
        role="dialog"
        aria-modal={childOverlayOpen ? undefined : true}
        aria-hidden={childOverlayOpen ? true : undefined}
        aria-label={`Viewing ${item.name}`}
        inert={childOverlayOpen}
      >
        <button
          type="button"
          className="gallery-item-modal__backdrop"
          onClick={closeModal}
          aria-label="Close"
          tabIndex={-1}
        />
        <div className="gallery-item-modal__panel">
          <header className="gallery-item-modal__header">
            <div className="gallery-item-modal__header-text">
              <h2 className="gallery-item-modal__title">{item.name}</h2>
              <span className="gallery-item-modal__counter">
                {index + 1} / {items.length}
              </span>
            </div>
            <div className="gallery-item-modal__header-actions">
              {!itemIsVideo && (
                <Tooltip content={viewerError ?? "Open in image preview"}>
                  <button
                    type="button"
                    className="gallery-item-modal__preview"
                    onClick={() => {
                      void handleOpenInViewer();
                    }}
                    disabled={openingInViewer || deleting}
                    aria-label="Open in image preview"
                  >
                    <Icon
                      icon={openingInViewer ? iconLoader2 : iconArrowUpRight}
                      spin={openingInViewer}
                    />
                  </button>
                </Tooltip>
              )}
              <Tooltip content={"Delete file"}>
                <button
                  type="button"
                  className="gallery-item-modal__delete"
                  onClick={openDeleteConfirm}
                  disabled={deleting}
                  aria-label={`Delete ${item.name}`}
                >
                  <Icon icon={iconTrash2} />
                </button>
              </Tooltip>
              <button
                type="button"
                className="gallery-item-modal__close"
                onClick={closeModal}
                disabled={deleting}
                aria-label="Close"
              >
                <Icon icon={iconX} />
              </button>
            </div>
          </header>

          <div className="gallery-item-modal__stage">
            <button
              type="button"
              className="gallery-item-modal__nav gallery-item-modal__nav--prev"
              onClick={onPrevious}
              aria-label="Previous item"
            >
              <Icon icon={iconChevronLeft} />
            </button>

            {itemIsVideo ? (
              <video
                key={item.path}
                className="gallery-item-modal__video"
                src={mediaUrl(item.path)}
                controls
                autoPlay
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
                className="gallery-item-modal__media-wrap"
                imgClassName="gallery-item-modal__img"
                src={mediaUrl(item.path)}
                alt={item.name}
                zoomable={bboxes.length === 0}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  recordResolution(img.naturalWidth, img.naturalHeight, item.path);
                }}
              >
                {bboxes.length > 0 && resolution && (
                  <BboxOverlay
                    bboxes={bboxes}
                    imageWidth={resolution.width}
                    imageHeight={resolution.height}
                    editable={bboxesEditable}
                    selectedIndex={selectedBboxIndex}
                    onSelectedIndexChange={bboxesEditable ? setSelectedBboxIndex : undefined}
                    onBboxesChange={bboxesEditable ? handleBboxesChange : undefined}
                  />
                )}
              </ZoomableImage>
            )}

            <button
              type="button"
              className="gallery-item-modal__nav gallery-item-modal__nav--next"
              onClick={onNext}
              aria-label="Next item"
            >
              <Icon icon={iconChevronRight} />
            </button>
          </div>

          <footer className="gallery-item-modal__footer">
            <GalleryItemModalMeta
              item={item}
              itemIsVideo={itemIsVideo}
              resolution={resolution}
              hasJsonCaption={hasJsonCaption}
              hasComfyWorkflow={hasComfyWorkflow}
              captionCharacterCount={captionCharacterCount}
            />

            <div className="gallery-item-modal__caption-editor">
              <div className="gallery-item-modal__caption-toolbar">
                <label htmlFor="gallery-item-caption" className="gallery-item-modal__caption-label">
                  Caption
                </label>
                <div className="gallery-item-modal__caption-actions">
                  {hasJsonCaption && (
                    <button
                      type="button"
                      className="gallery-item-modal__caption-action"
                      onClick={openJsonEditor}
                      disabled={!canEditJson}
                      aria-label="Edit .json caption"
                    >
                      <Icon icon={iconBraces} className="gallery-item-modal__caption-action-icon" />
                      Edit .json
                    </button>
                  )}
                  <button
                    type="button"
                    className={classNames(
                      "gallery-item-modal__caption-action",
                      copyState === "copied" && "gallery-item-modal__caption-action--copied",
                      copyState === "error" && "gallery-item-modal__caption-action--error",
                    )}
                    onClick={() => {
                      void copyText(copyContent);
                    }}
                    disabled={!canCopyCaption}
                    aria-label={copyLabel}
                  >
                    <Icon icon={iconCopy} className="gallery-item-modal__caption-action-icon" />
                    {copyLabel}
                  </button>
                </div>
              </div>
              <CaptionEditor
                id="gallery-item-caption"
                value={caption}
                placeholder={placeholder}
                variant={captionDisplay.variant}
                saveState={saveState}
                searchQuery={searchQuery}
                searchRegex={searchRegex}
                aria-label={`Caption for ${item.name}`}
                aria-invalid={saveState === "error"}
                title={saveState === "error" ? (saveError ?? "Save failed") : undefined}
                onChange={handleCaptionChange}
              />
            </div>

            <GalleryItemModalBboxList
              bboxes={bboxes}
              bboxesEditable={bboxesEditable}
              selectedBboxIndex={selectedBboxIndex}
              onSelectedBboxIndexChange={setSelectedBboxIndex}
            />
          </footer>
        </div>
      </div>

      {deleteConfirmOpen && (
        <ConfirmDialog
          title="Delete file?"
          description={
            <span>
              This will permanently delete <strong>{item.name}</strong> and any matching caption
              sidecars (.txt/.json) in this folder.
            </span>
          }
          confirmLabel="Delete"
          confirmVariant="danger"
          busy={deleting}
          onConfirm={() => {
            void confirmDelete();
          }}
          onCancel={cancelDeleteConfirm}
        />
      )}

      {jsonEditorOpen && jsonEditorContent && (
        <Suspense fallback={null}>
          <GalleryItemJsonEditorModal
            itemName={item.name}
            initialContent={jsonEditorContent}
            sessionKey={jsonEditorSession}
            saving={jsonSaveState === "saving"}
            saveError={jsonSaveError}
            onClose={closeJsonEditor}
            onSave={saveJsonEditor}
          />
        </Suspense>
      )}
    </>,
    document.body,
  );
}
