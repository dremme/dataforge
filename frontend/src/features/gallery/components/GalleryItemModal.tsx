import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModalShell } from "@/shared/ui/ModalShell";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import {
  deleteMedia,
  openMediaInViewer,
  type MediaTransferMode,
} from "@/features/gallery/api/media";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import { formatApiError } from "@/shared/api/http";
import { useComfyWorkflowFlag } from "@/features/gallery/hooks/useComfyWorkflowFlag";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import { useGalleryItemCaption } from "@/features/gallery/hooks/useGalleryItemCaption";
import { useGifFrameCapture } from "@/features/gallery/hooks/useGifFrameCapture";
import { useGifFrameCount } from "@/features/gallery/hooks/useGifFrameCount";
import { useGifToMp4 } from "@/features/gallery/hooks/useGifToMp4";
import { useMediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import { useMediaTransfer } from "@/features/gallery/hooks/useMediaTransfer";
import { useImageEdit } from "@/features/gallery/hooks/useImageEdit";
import { useVideoEdit } from "@/features/gallery/hooks/useVideoEdit";
import { useVideoFrameCapture } from "@/features/gallery/hooks/useVideoFrameCapture";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useNotify } from "@/shared/notifications/notifications";
import {
  iconArrowUpRight,
  iconBraces,
  iconCamera,
  iconChevronLeft,
  iconChevronRight,
  iconCopy,
  iconCrop,
  iconFolderInput,
  iconLoader2,
  iconMessageCheck,
  iconScissors,
  iconTrash2,
  iconVideo,
  iconX,
} from "@/shared/icons";
import { isResolvableIssueItem } from "@/features/gallery/lib/issues";
import {
  isEditableImage,
  isEditableVideo,
  isGif,
  isMotion,
  isVideo,
  mediaLabelFor,
} from "@/features/gallery/lib/itemKind";
import type { FrameCapture } from "@/features/gallery/lib/frameCapture";
import { formatFrameOrdinal } from "@/features/gallery/lib/gifFrameCapture";
import { formatFrameTime, FRAME_STEP_SECONDS } from "@/features/gallery/lib/videoFrameCapture";
import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import {
  collectAdjacentModalMediaTargets,
  schedulePrefetchModalMedia,
} from "@/features/gallery/lib/modalMediaPrefetch";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { GIF_MP4_FRAME_RATE } from "@/shared/constants";
import { classNames } from "@/shared/lib/classNames";
import { CaptionEditor } from "@/shared/ui/CaptionEditor";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FileImportOverwriteDialog } from "@/features/folder/components/FileImportOverwriteDialog";
import { GalleryItemModalMeta } from "./GalleryItemModalMeta";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import { TransferMediaDialog } from "./TransferMediaDialog";
import { FrameCaptureBar } from "./FrameCaptureBar";
import { CropOverlay } from "./CropOverlay";
import { ImageEditPanel } from "./ImageEditPanel";
import { ImageEditStage } from "./ImageEditStage";
import { VideoEditPanel } from "./VideoEditPanel";
import { ZoomableImage } from "./ZoomableImage";
import { imageOriginalUrl } from "@/features/gallery/api/imageEdit";
import { videoOriginalUrl } from "@/features/gallery/api/videoEdit";
import { evenTrunc } from "@/features/gallery/lib/videoEdit";

/** Stands in when the owner supplies no transfer handler — the buttons are hidden then. */
const noop = () => {};

const GalleryItemJsonEditorDialog = lazy(() =>
  import("./GalleryItemJsonEditorDialog").then((module) => ({
    default: module.GalleryItemJsonEditorDialog,
  })),
);

interface GalleryItemModalProps {
  items: GalleryItem[];
  index: number;
  /** Active gallery toolbar search — highlighted in the caption field. */
  searchQuery?: string;
  searchRegex?: boolean;
  /** Folder the viewed item lives in — the transfer picker's origin. Move/copy
   *  stay hidden without it, since the picker reads it during render. */
  currentFolder?: string;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onCaptionSaved: (path: string, update: CaptionSaveResponse) => void;
  onDeleted?: (path: string) => void;
  /** Takes the moved path so the owner can drop it and advance this modal. */
  onMoved?: (paths: string[]) => void | Promise<void>;
  /** A copy or a saved video frame leaves the item here, so only folder stats change. */
  onCopied?: () => void | Promise<void>;
  /** Hands the item off to the issue resolver; this modal closes in the same commit. */
  onResolveIssue?: (item: GalleryItem) => void;
  onJsonEditorOpenChange?: (open: boolean) => void;
}

export function GalleryItemModal({
  items,
  index,
  searchQuery = "",
  searchRegex = false,
  currentFolder,
  onClose,
  onPrevious,
  onNext,
  onCaptionSaved,
  onDeleted,
  onMoved,
  onCopied,
  onResolveIssue,
  onJsonEditorOpenChange,
}: GalleryItemModalProps) {
  const item = items[index];
  const { recordResolution, getResolution } = useMediaResolution();
  const hasComfyWorkflow = useComfyWorkflowFlag(item?.path);
  const notify = useNotify();

  const {
    caption,
    captionContent,
    hasJsonCaption,
    saveState,
    saveError,
    handleCaptionChange,
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
  // Owned here so next/prev can keep frame capture on across videos and GIFs.
  // Each capture hook used to hold its own flag, which dropped mode on every
  // item swap and could not stick when switching video <-> GIF.
  const [frameMode, setFrameMode] = useState(false);
  // Owned here for the same reason, and mutually exclusive with it: one `<video>`
  // cannot serve a capture scrubber and an edit timeline at once. The draft resets
  // per item, but the mode itself survives navigation.
  //
  // One flag for both editors rather than two. Which one it turns on follows from the
  // item, and the two can never apply to the same file, so a second piece of state
  // could only ever disagree with this one.
  const [editMode, setEditMode] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);

  const transferPaths = useMemo(() => (item ? [item.path] : []), [item]);

  const emptyPreviewMessage = useCallback((mode: MediaTransferMode, paths: string[]) => {
    const verb = mode === "move" ? "moved" : "copied";
    return `${pathBaseName(paths[0])} cannot be ${verb} to that folder.`;
  }, []);

  const copySuccessMessage = useCallback(
    (succeeded: string[], destinationLabel: string) =>
      `Copied ${pathBaseName(succeeded[0])} to ${destinationLabel}.`,
    [],
  );

  const transfer = useMediaTransfer({
    paths: transferPaths,
    onMoved: onMoved ?? noop,
    onCopied: onCopied ?? noop,
    emptyPreviewMessage,
    copySuccessMessage,
  });

  const itemIsGif = item ? isGif(item) : false;
  const itemIsVideo = item ? isVideo(item) : false;
  const gifFrameCount = useGifFrameCount(item?.path, itemIsGif);

  // Both hooks run unconditionally - hooks cannot be called behind a branch - and
  // the shared `FrameCapture` shape lets the rest of the modal read whichever one
  // matches the item without asking again which format it is.
  const videoCapture = useVideoFrameCapture({
    item,
    folderPath: currentFolder,
    onSaved: onCopied,
    frameMode,
    setFrameMode,
  });
  const gifCapture = useGifFrameCapture({
    item,
    frameCount: gifFrameCount,
    folderPath: currentFolder,
    onSaved: onCopied,
    frameMode,
    setFrameMode,
  });
  const frameCapture: FrameCapture = itemIsGif ? gifCapture : videoCapture;

  const videoEdit = useVideoEdit({
    item,
    // The capture hook already owns the ref on the one `<video>`, and only one of
    // the two modes can be on, so they share it rather than racing for it.
    videoRef: videoCapture.videoRef,
    onEdited: onCopied,
    editMode,
    setEditMode,
  });

  const imageEdit = useImageEdit({
    item,
    onEdited: onCopied,
    editMode,
    setEditMode,
  });

  const gifToMp4 = useGifToMp4({ item, onConverted: onCopied });

  const { transferPicker, overwritePrompt, transferring } = transfer;
  /** Modal work other than a frame save — the capture bar locks itself on this. */
  const otherWorkBusy = deleting || transferring !== null || gifToMp4.converting;
  const busy = otherWorkBusy || frameCapture.saving || videoEdit.applying || imageEdit.applying;
  // Frame mode stays out of this flag: it feeds `ModalShell`'s `suspended`, which
  // makes the panel inert, and the slider has to stay reachable.
  const childOverlayOpen =
    deleteConfirmOpen ||
    revertConfirmOpen ||
    jsonEditorOpen ||
    transfer.transferDialogOpen ||
    gifToMp4.conflict !== null;
  const canTransfer = Boolean(currentFolder) && Boolean(onMoved) && Boolean(onCopied);

  const jsonEditorContent = useMemo(
    () => (captionContent ? captionContent.trimEnd() : null),
    [captionContent],
  );

  // Transfer state is deliberately absent here. A successful move advances this
  // modal to the next item while the flow's own `finally` is still pending, so
  // clearing it on the swap would race the hook and re-enable the buttons early.
  useEffect(() => {
    setJsonEditorOpen(false);
    setJsonEditorSession(0);
    setDeleteConfirmOpen(false);
    setDeleting(false);
    setOpeningInViewer(false);
    setViewerError(null);
    resetJsonSaveState();
  }, [item?.path, resetJsonSaveState]);

  // Sticky capture only applies to items that can actually capture. Landing on a
  // still (or losing the destination folder) drops the mode so the bar does not
  // hang over a surface that has no scrubber.
  useEffect(() => {
    if (!item || !currentFolder || (!itemIsVideo && !itemIsGif)) {
      setFrameMode(false);
    }
  }, [item, currentFolder, itemIsVideo, itemIsGif]);

  // Editing needs no destination folder - it rewrites the file where it already is - so
  // this only drops the mode when the item itself cannot be edited by either editor.
  useEffect(() => {
    if (!item || (!isEditableVideo(item) && !isEditableImage(item))) {
      setEditMode(false);
      setRevertConfirmOpen(false);
    }
  }, [item]);

  // Warm next/previous full-size media (idle/low priority) so nav does not flash empty.
  useEffect(() => {
    return schedulePrefetchModalMedia(collectAdjacentModalMediaTargets(items, index));
  }, [index, items]);

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

  const toggleFrameMode = useCallback(() => {
    setEditMode(false);
    frameCapture.toggleFrameMode();
  }, [frameCapture]);

  const toggleVideoEditMode = useCallback(() => {
    setFrameMode(false);
    videoEdit.toggleEditMode();
  }, [videoEdit]);

  const toggleImageEditMode = useCallback(() => {
    setFrameMode(false);
    imageEdit.toggleEditMode();
  }, [imageEdit]);

  const { copyState, copyLabel, copyText } = useCopyFeedback();

  const closeModal = useCallback(() => {
    if (busy) return;
    flushPendingSave();
    onClose();
  }, [busy, flushPendingSave, onClose]);

  const openDeleteConfirm = useCallback(() => {
    if (busy) return;
    setDeleteConfirmOpen(true);
  }, [busy]);

  const cancelDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
  }, [deleting]);

  const handleResolveIssue = useCallback(() => {
    if (!item || busy || !onResolveIssue) return;
    flushPendingSave();
    // Hand over what the editor shows, not the folder snapshot: the flushed save
    // has not reached disk yet when the resolver seeds itself from this item.
    onResolveIssue({ ...item, description: caption });
  }, [busy, caption, flushPendingSave, item, onResolveIssue]);

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
    } catch (error) {
      setDeleteConfirmOpen(false);
      notify({
        variant: "danger",
        message: `Could not delete ${item.name}: ${formatApiError(error)}`,
      });
    } finally {
      setDeleting(false);
    }
  }, [deleting, flushPendingSave, item, notify, onDeleted]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // A focused scrubber is exempt via `isEditableTarget` so arrows still step
      // frames. Everywhere else, arrows move to the next/prev gallery item even
      // while frame capture is on — mode sticks when the next item can capture.
      if (childOverlayOpen || busy) return;
      if (isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [busy, childOverlayOpen, onPrevious, onNext]);

  // Which editor the one `editMode` flag drives. Derived here, above the early return,
  // so the hooks below can be gated on it without any of them being called conditionally.
  const canEditVideoItem = item ? isEditableVideo(item) : false;
  const canEditImageItem = item ? isEditableImage(item) : false;

  // In frame mode Escape steps back to plain viewing instead of closing outright.
  // `ModalShell` stands down for the duration via its `escape` prop below.
  useEscapeKey(frameCapture.exitFrameMode, frameCapture.frameMode && !busy);
  // A file is one kind or the other, so these can never both be live.
  useEscapeKey(videoEdit.exitEditMode, editMode && canEditVideoItem && !busy);
  useEscapeKey(imageEdit.exitEditMode, editMode && canEditImageItem && !busy);

  if (!item) return null;

  const mediaLabel = mediaLabelFor(item);
  const resolution = getResolution(item);
  const captionDisplay = getGalleryItemCaptionDisplay(item, mediaLabel);
  const captionCharacterCount = caption.length;
  const copyContent = hasJsonCaption ? (captionContent ?? "") : caption;
  const canCopyCaption = copyContent.length > 0;
  const canEditJson = hasJsonCaption && (jsonEditorContent?.length ?? 0) > 0;
  const canResolveIssue = isResolvableIssueItem(item) && Boolean(onResolveIssue);
  // Only the destination folder is required; a missing `onCopied` costs the refresh,
  // not the save, so it must not gate the toggle the way `canTransfer` does.
  const canCaptureFrame = (itemIsVideo || itemIsGif) && Boolean(currentFolder);
  const placeholder =
    captionDisplay.variant === "success" ? "Add a caption..." : captionDisplay.message;

  return (
    <>
      <ModalShell
        block="gallery-item-modal"
        label={`Viewing ${item.name}`}
        onClose={closeModal}
        busy={busy}
        suspended={childOverlayOpen}
        // The scroll lock belongs to `useGalleryOverlays`, which holds it across
        // the whole overlay session. That leaves the depth non-zero here, so the
        // nesting decision has to be stated rather than measured.
        nested={false}
        escape={frameCapture.frameMode || editMode ? "none" : "bubble"}
        panelRef={modalRef}
      >
        <header className="gallery-item-modal__header">
          <div className="gallery-item-modal__header-text">
            <h2 className="gallery-item-modal__title">{item.name}</h2>
            <span className="gallery-item-modal__counter">
              {index + 1} / {items.length}
            </span>
          </div>
          <div className="gallery-item-modal__header-actions">
            {!isMotion(item) && (
              <Tooltip content={viewerError ?? "Open in image preview"}>
                <button
                  type="button"
                  className="gallery-item-modal__preview"
                  onClick={() => {
                    void handleOpenInViewer();
                  }}
                  disabled={openingInViewer || busy}
                  aria-label="Open in image preview"
                >
                  <Icon
                    icon={openingInViewer ? iconLoader2 : iconArrowUpRight}
                    spin={openingInViewer}
                  />
                </button>
              </Tooltip>
            )}
            {canEditVideoItem && (
              <Tooltip content={editMode ? "Exit video editing" : "Edit video"}>
                <button
                  type="button"
                  className={classNames(
                    "gallery-item-modal__edit-toggle",
                    editMode && "gallery-item-modal__edit-toggle--active",
                  )}
                  onClick={toggleVideoEditMode}
                  disabled={busy}
                  aria-pressed={editMode}
                  aria-label={
                    editMode ? `Exit video editing for ${item.name}` : `Edit ${item.name}`
                  }
                >
                  <Icon icon={iconScissors} />
                </button>
              </Tooltip>
            )}
            {canEditImageItem && (
              <Tooltip content={editMode ? "Exit image editing" : "Edit image"}>
                <button
                  type="button"
                  className={classNames(
                    "gallery-item-modal__edit-toggle",
                    editMode && "gallery-item-modal__edit-toggle--active",
                  )}
                  onClick={toggleImageEditMode}
                  disabled={busy}
                  aria-pressed={editMode}
                  aria-label={
                    editMode ? `Exit image editing for ${item.name}` : `Edit ${item.name}`
                  }
                >
                  <Icon icon={iconCrop} />
                </button>
              </Tooltip>
            )}
            {itemIsGif && (
              <Tooltip content={`Convert to MP4 (${GIF_MP4_FRAME_RATE} fps)`}>
                <button
                  type="button"
                  className="gallery-item-modal__convert"
                  onClick={gifToMp4.convert}
                  disabled={busy}
                  aria-busy={gifToMp4.converting || undefined}
                  aria-label={`Convert ${item.name} to MP4`}
                >
                  <Icon
                    icon={gifToMp4.converting ? iconLoader2 : iconVideo}
                    spin={gifToMp4.converting}
                  />
                </button>
              </Tooltip>
            )}
            {canCaptureFrame && (
              <Tooltip
                content={frameCapture.frameMode ? "Exit frame capture" : "Save a frame as JPG"}
              >
                <button
                  type="button"
                  className={classNames(
                    "gallery-item-modal__frame-toggle",
                    frameCapture.frameMode && "gallery-item-modal__frame-toggle--active",
                  )}
                  onClick={toggleFrameMode}
                  disabled={busy}
                  aria-pressed={frameCapture.frameMode}
                  aria-label={
                    frameCapture.frameMode
                      ? `Exit frame capture for ${item.name}`
                      : `Save a frame from ${item.name}`
                  }
                >
                  <Icon icon={iconCamera} />
                </button>
              </Tooltip>
            )}
            {canTransfer && (
              <>
                <Tooltip content={"Copy file"}>
                  <button
                    type="button"
                    className="gallery-item-modal__copy"
                    onClick={() => transfer.openTransferPicker("copy")}
                    disabled={busy}
                    aria-busy={transferring === "copy" || undefined}
                    aria-label={`Copy ${item.name} to another folder`}
                  >
                    <Icon
                      icon={transferring === "copy" ? iconLoader2 : iconCopy}
                      spin={transferring === "copy"}
                    />
                  </button>
                </Tooltip>
                <Tooltip content={"Move file"}>
                  <button
                    type="button"
                    className="gallery-item-modal__move"
                    onClick={() => transfer.openTransferPicker("move")}
                    disabled={busy}
                    aria-busy={transferring === "move" || undefined}
                    aria-label={`Move ${item.name} to another folder`}
                  >
                    <Icon
                      icon={transferring === "move" ? iconLoader2 : iconFolderInput}
                      spin={transferring === "move"}
                    />
                  </button>
                </Tooltip>
              </>
            )}
            <Tooltip content={"Delete file"}>
              <button
                type="button"
                className="gallery-item-modal__delete"
                onClick={openDeleteConfirm}
                disabled={busy}
                aria-label={`Delete ${item.name}`}
              >
                <Icon icon={iconTrash2} />
              </button>
            </Tooltip>
            <button
              type="button"
              className="gallery-item-modal__close"
              onClick={closeModal}
              disabled={busy}
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
            disabled={busy}
            aria-label="Previous item"
          >
            <Icon icon={iconChevronLeft} />
          </button>

          {itemIsVideo ? (
            <>
              <video
                // Editing plays the untouched original, so the source has to change with
                // the mode, not just its bytes - hence the key.
                key={editMode ? `${item.path}#original` : item.path}
                ref={videoCapture.videoRef}
                className="gallery-item-modal__video"
                src={editMode ? videoOriginalUrl(item.path) : galleryItemMediaUrl(item)}
                // The native timeline would let the user seek behind the capture
                // slider's or the trim handles' back, so both modes own scrubbing.
                controls={!frameCapture.frameMode && !editMode}
                autoPlay={!editMode}
                muted
                playsInline
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  recordResolution(video.videoWidth, video.videoHeight, item.path);
                  videoCapture.handleLoadedMetadata(video);
                  videoEdit.handleLoadedMetadata(video);
                }}
                // Streamed MP4s report `Infinity` at `loadedmetadata` and only settle
                // on a real duration later, which would strand the slider without this.
                onDurationChange={(event) => {
                  videoCapture.handleLoadedMetadata(event.currentTarget);
                  videoEdit.handleLoadedMetadata(event.currentTarget);
                }}
              />
              {editMode && videoEdit.cropActive && (
                <CropOverlay
                  mediaRef={videoCapture.videoRef}
                  crop={videoEdit.draft.crop}
                  sourceWidth={videoEdit.sourceWidth}
                  sourceHeight={videoEdit.sourceHeight}
                  aspectRatio={videoEdit.aspectRatio}
                  round={evenTrunc}
                  disabled={busy}
                  onCropChange={videoEdit.setCrop}
                />
              )}
            </>
          ) : editMode && canEditImageItem ? (
            // The untouched original, for the same reason the video editor plays one:
            // the draft is expressed against it. Zooming is deliberately given up for
            // the duration - the stage carries the rotation instead.
            <ImageEditStage
              edit={imageEdit}
              src={imageOriginalUrl(item.path)}
              alt={item.name}
              disabled={busy}
            />
          ) : (
            <ZoomableImage
              // Frame mode swaps in a still, so it needs a fresh instance: a zoom
              // transform left over from the animated GIF would be applied to a
              // differently decoded image.
              key={gifCapture.previewUrl ? `${item.path}#frame` : item.path}
              className="gallery-item-modal__media-wrap"
              imgClassName="gallery-item-modal__img"
              src={gifCapture.previewUrl ?? galleryItemMediaUrl(item)}
              alt={item.name}
              onLoad={(event) => {
                const img = event.currentTarget;
                recordResolution(img.naturalWidth, img.naturalHeight, item.path);
              }}
            />
          )}

          <button
            type="button"
            className="gallery-item-modal__nav gallery-item-modal__nav--next"
            onClick={onNext}
            disabled={busy}
            aria-label="Next item"
          >
            <Icon icon={iconChevronRight} />
          </button>
        </div>

        {/* Outside the stage on purpose: that block centres its content and hangs
            the nav buttons over it, so a strip inside would fight both. */}
        {frameCapture.frameMode &&
          (itemIsGif ? (
            <FrameCaptureBar
              min={0}
              max={Math.max(0, gifCapture.frameCount - 1)}
              step={1}
              value={gifCapture.frameIndex}
              ready={gifCapture.ready}
              saving={gifCapture.saving}
              busy={otherWorkBusy}
              currentLabel={formatFrameOrdinal(gifCapture.frameIndex, gifCapture.frameCount)}
              totalLabel={String(gifCapture.frameCount)}
              hint="Frame count loads with the GIF."
              onValueChange={gifCapture.setFrameIndex}
              onStepFrame={gifCapture.stepFrame}
              onSave={gifCapture.saveFrame}
            />
          ) : (
            <FrameCaptureBar
              min={0}
              max={videoCapture.duration}
              step={FRAME_STEP_SECONDS}
              value={videoCapture.sliderTime}
              ready={videoCapture.ready}
              saving={videoCapture.saving}
              busy={otherWorkBusy}
              currentLabel={formatFrameTime(videoCapture.displayTime)}
              totalLabel={formatFrameTime(videoCapture.duration)}
              hint="Frame times load with the video."
              onValueChange={videoCapture.setSliderTime}
              onStepFrame={videoCapture.stepFrame}
              onSave={videoCapture.saveFrame}
            />
          ))}

        {editMode && canEditVideoItem && (
          <VideoEditPanel
            edit={videoEdit}
            busy={otherWorkBusy}
            onRevertRequested={() => setRevertConfirmOpen(true)}
          />
        )}

        {editMode && canEditImageItem && (
          <ImageEditPanel
            edit={imageEdit}
            busy={otherWorkBusy}
            onRevertRequested={() => setRevertConfirmOpen(true)}
          />
        )}

        {/* Hidden while editing rather than merely ignored: the caption and the meta
            strip have nothing to do with a cut, and the height they give back goes to
            the stage, where a larger frame is worth more than either of them. */}
        {!editMode && (
          <footer className="gallery-item-modal__footer">
            <GalleryItemModalMeta
              item={item}
              resolution={resolution}
              hasComfyWorkflow={hasComfyWorkflow}
              captionCharacterCount={captionCharacterCount}
            />

            <div className="gallery-item-modal__caption-editor">
              <div className="gallery-item-modal__caption-toolbar">
                <label htmlFor="gallery-item-caption" className="gallery-item-modal__caption-label">
                  Caption
                </label>
                <div className="gallery-item-modal__caption-actions">
                  {canResolveIssue && (
                    <button
                      type="button"
                      className="gallery-item-modal__caption-action gallery-item-modal__caption-action--issue"
                      onClick={handleResolveIssue}
                      disabled={busy}
                      aria-label={`Resolve caption issue for ${item.name}`}
                    >
                      <Icon
                        icon={iconMessageCheck}
                        className="gallery-item-modal__caption-action-icon"
                      />
                      Resolve issue
                    </button>
                  )}
                  {hasJsonCaption && (
                    <button
                      type="button"
                      className="gallery-item-modal__caption-action"
                      onClick={openJsonEditor}
                      disabled={!canEditJson}
                      aria-label="Edit JSON caption"
                    >
                      <Icon icon={iconBraces} className="gallery-item-modal__caption-action-icon" />
                      Edit JSON
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
                // A fresh editor per item: CodeMirror maps its selection through the
                // document swap, so a reused one lands selected on the next caption.
                key={item.path}
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
          </footer>
        )}
      </ModalShell>

      {deleteConfirmOpen && (
        <ConfirmDialog
          title="Delete file?"
          description={
            <span>
              This will delete <strong>{item.name}</strong>, any matching caption sidecars (
              {CAPTION_SIDECAR_EXTENSION_LIST}) in this folder, and the stored original if the file
              has been edited.
              <br />
              On Windows, files are moved to the Recycle Bin.
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

      {revertConfirmOpen && (
        <ConfirmDialog
          title="Restore the original?"
          description={
            <span>
              This replaces <strong>{item.name}</strong> with the untouched original stored beside
              it, and discards every edit applied so far.
            </span>
          }
          confirmLabel="Restore"
          confirmVariant="danger"
          busy={videoEdit.applying || imageEdit.applying}
          onConfirm={() => {
            setRevertConfirmOpen(false);
            if (canEditVideoItem) videoEdit.revert();
            else imageEdit.revert();
          }}
          onCancel={() => setRevertConfirmOpen(false)}
        />
      )}

      {gifToMp4.conflict && (
        <ConfirmDialog
          title="Replace the existing MP4?"
          description={
            <span>
              <strong>{gifToMp4.conflict}</strong> already sits beside this GIF. Converting replaces
              it with a fresh encode of the animation.
            </span>
          }
          confirmLabel="Replace"
          confirmVariant="danger"
          onConfirm={gifToMp4.confirmOverwrite}
          onCancel={gifToMp4.cancelOverwrite}
        />
      )}

      {transferPicker && currentFolder && (
        <TransferMediaDialog
          mode={transferPicker}
          currentFolder={currentFolder}
          selectedCount={1}
          description={
            <>
              Choose a destination for <strong>{item.name}</strong>.
            </>
          }
          busy={transferring !== null}
          onClose={transfer.closeTransferPicker}
          onSelectDestination={(path) => {
            transfer.selectDestination(transferPicker, path);
          }}
        />
      )}

      {overwritePrompt && (
        <FileImportOverwriteDialog
          conflicts={overwritePrompt.conflicts}
          busy={transferring !== null}
          descriptionSuffix={
            overwritePrompt.mode === "move"
              ? "Choose whether to replace them or move only new files."
              : "Choose whether to replace them or copy only new files."
          }
          onReplaceExisting={() => transfer.confirmOverwrite(true)}
          onCopyNewOnly={() => transfer.confirmOverwrite(false)}
          onCancel={transfer.closeOverwritePrompt}
        />
      )}

      {jsonEditorOpen && jsonEditorContent && (
        <Suspense fallback={null}>
          <GalleryItemJsonEditorDialog
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
    </>
  );
}
