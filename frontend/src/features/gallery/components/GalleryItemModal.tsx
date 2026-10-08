import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { WorkspaceAction, WorkspaceTransition } from "@/app/hooks/useWorkspaceTransitions";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { readStored, writeStored } from "@/shared/lib/storage";
import { ModalShell } from "@/shared/ui/ModalShell";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { matchesShortcut, queueIndexAfter, queueStepFor, SHORTCUTS } from "@/shared/lib/shortcuts";
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
import { useCaptionBackup } from "@/features/gallery/hooks/useCaptionBackup";
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
import { getScrollLockDepth } from "@/shared/hooks/scrollLockManager";
import { useNotify } from "@/shared/notifications/notifications";
import {
  iconArchiveRestore,
  iconArrowUpRight,
  iconCamera,
  iconChevronLeft,
  iconChevronRight,
  iconCopy,
  iconFolderInput,
  iconLoader2,
  iconMessageCheck,
  iconRotateCcw,
  iconScanSquare,
  iconSquarePen,
  iconTrash2,
  iconVideo,
  iconX,
  iconExpand,
  iconMinimize,
} from "@/shared/icons";
import { isResolvableIssueItem } from "@/features/gallery/lib/issues";
import { isCandidateItem } from "@/features/gallery/lib/candidateReview";
import {
  isEditableImage,
  isEditableVideo,
  isGif,
  isMotion,
  isVideo,
  mediaLabelFor,
} from "@/features/gallery/lib/itemKind";
import type { AdjustedPicture } from "@/features/gallery/lib/adjustedPicture";
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
import { buildCaptionVocabulary } from "@/features/gallery/lib/captionVocabulary";
import { CaptionEditor } from "@/shared/ui/CaptionEditor";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FileImportOverwriteDialog } from "@/features/folder/components/FileImportOverwriteDialog";
import { CaptionSaveStatus } from "./CaptionSaveStatus";
import { MediaInfoBar } from "./MediaInfoBar";
import { Icon } from "@/shared/ui/Icon";
import { TokenEstimate } from "@/shared/ui/TokenEstimate";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ComfyWorkflowDialog } from "./ComfyWorkflowDialog";
import { TransferMediaDialog } from "./TransferMediaDialog";
import { FrameCaptureBar } from "./FrameCaptureBar";
import { CropOverlay } from "./CropOverlay";
import { AdjustCanvas } from "./AdjustCanvas";
import { MaskOverlay } from "./MaskOverlay";
import { ImageEditPanel } from "./ImageEditPanel";
import { ImageEditStage } from "./ImageEditStage";
import { VideoEditPanel } from "./VideoEditPanel";
import { ZoomableImage } from "./ZoomableImage";
import { imageOriginalUrl } from "@/features/gallery/api/imageEdit";
import { videoOriginalUrl } from "@/features/gallery/api/videoEdit";
import { evenTrunc } from "@/features/gallery/lib/videoEdit";

const noop = () => {};

// Widgets outside the inspector that use arrow keys themselves.
const OUTSIDE_ARROW_OWNERS =
  '[role="menu"], [role="listbox"], [role="slider"], [role="separator"], [role="tablist"], select';

interface GalleryItemModalProps {
  items: GalleryItem[];
  index: number;
  searchQuery?: string;
  searchRegex?: boolean;
  /** Whether this folder has a caption backup at all; gates the per-file restore. */
  hasCaptionBackup?: boolean;
  /** Transfer picker's origin; move/copy stay hidden without it. */
  currentFolder?: string;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onGoTo?: (index: number) => void;
  onCaptionSaved: (path: string, update: CaptionSaveResponse) => void;
  onDeleted?: (path: string) => void;
  onMoved?: (paths: string[]) => void | Promise<void>;
  onCopied?: () => void | Promise<void>;
  onResolveIssue?: (item: GalleryItem) => void;
  onReviewCandidate?: (item: GalleryItem) => void;
  focusView?: boolean;
  onFocusViewChange?: (focus: boolean) => void;
  /** Editing or capture expanded a docked view: the gallery is covered, its layout unsaved. */
  onEditExpandedChange?: (expanded: boolean) => void;
  transitionRef?: RefObject<WorkspaceTransition | null>;
  suspended?: boolean;
}

export function GalleryItemModal({
  items,
  index,
  searchQuery = "",
  searchRegex = false,
  hasCaptionBackup = false,
  currentFolder,
  onClose,
  onPrevious,
  onNext,
  onGoTo,
  onCaptionSaved,
  onDeleted,
  onMoved,
  onCopied,
  onResolveIssue,
  onReviewCandidate,
  focusView = true,
  onFocusViewChange,
  onEditExpandedChange,
  transitionRef,
  suspended = false,
}: GalleryItemModalProps) {
  const item = items[index];
  const { recordResolution, getResolution } = useMediaResolution();
  const hasComfyWorkflow = useComfyWorkflowFlag(item?.path);
  const notify = useNotify();

  const {
    caption,
    saveState,
    saveError,
    canRevert,
    handleCaptionChange,
    revertCaption,
    retrySave,
    flushPendingSave,
    discardCaptionChanges,
  } = useGalleryItemCaption({ item, onCaptionSaved });
  const backupCaption = useCaptionBackup(item?.path, hasCaptionBackup);
  const captionCompletions = useMemo(() => buildCaptionVocabulary(items), [items]);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openingInViewer, setOpeningInViewer] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  // Owned here so next/prev keeps capture across videos and GIFs; per-hook flags dropped it.
  const [frameMode, setFrameMode] = useState(false);
  // Mutually exclusive with frameMode: one `<video>` cannot serve a scrubber and a timeline.
  // One flag for both editors; which one it turns on follows from the item.
  const [editMode, setEditMode] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [comfyWorkflowOpen, setComfyWorkflowOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const width = Number(readStored("workspace-inspector-width"));
    return width >= 320 && width <= 520 ? width : 380;
  });
  const narrow = useMediaQuery("(max-width: 999px)");
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const pendingActionRef = useRef<WorkspaceAction | null>(null);
  const [leaveFailed, setLeaveFailed] = useState(false);

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

  // Both hooks run unconditionally; hooks cannot be called behind a branch.
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

  const standbyVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoEdit = useVideoEdit({
    item,
    videoRef: videoCapture.videoRef,
    standbyVideoRef,
    onEdited: onCopied,
    editMode,
    setEditMode,
  });
  const [videoPicture, setVideoPicture] = useState<AdjustedPicture | null>(null);

  const imageEdit = useImageEdit({
    item,
    onEdited: onCopied,
    editMode,
    setEditMode,
  });

  const gifToMp4 = useGifToMp4({ item, onConverted: onCopied });

  const { transferPicker, overwritePrompt, transferring } = transfer;
  const otherWorkBusy = deleting || transferring !== null || gifToMp4.converting;
  const busy = otherWorkBusy || frameCapture.saving || videoEdit.applying || imageEdit.applying;
  const leave = useCallback(
    async (action: WorkspaceAction) => {
      if (busy || leavingRef.current) return;
      leavingRef.current = true;
      setLeaving(true);
      const saved = await flushPendingSave();
      leavingRef.current = false;
      setLeaving(false);
      if (!saved) {
        pendingActionRef.current = action;
        setLeaveFailed(true);
        return;
      }
      pendingActionRef.current = null;
      setLeaveFailed(false);
      await action();
    },
    [busy, flushPendingSave],
  );

  useEffect(() => {
    if (!transitionRef) return;
    transitionRef.current = leave;
    return () => {
      if (transitionRef.current === leave) transitionRef.current = null;
    };
  }, [leave, transitionRef]);
  // Frame mode stays out: this feeds ModalShell.suspended, which would make the slider inert.
  const childOverlayOpen =
    suspended ||
    deleteConfirmOpen ||
    revertConfirmOpen ||
    comfyWorkflowOpen ||
    transfer.transferDialogOpen ||
    gifToMp4.conflict !== null;
  const canTransfer = Boolean(currentFolder) && Boolean(onMoved) && Boolean(onCopied);

  // Transfer state stays out: a move advances the item while finally is pending, re-enabling early.
  useEffect(() => {
    setDeleteConfirmOpen(false);
    setDeleting(false);
    setOpeningInViewer(false);
    setViewerError(null);
    setComfyWorkflowOpen(false);
  }, [item?.path]);

  // Drop sticky capture on a still or missing destination so the bar needs no scrubber.
  useEffect(() => {
    if (!item || !currentFolder || (!itemIsVideo && !itemIsGif)) {
      setFrameMode(false);
    }
  }, [item, currentFolder, itemIsVideo, itemIsGif]);

  useEffect(() => {
    if (!item || (!isEditableVideo(item) && !isEditableImage(item))) {
      setEditMode(false);
      setRevertConfirmOpen(false);
    }
  }, [item]);

  useEffect(() => {
    return schedulePrefetchModalMedia(collectAdjacentModalMediaTargets(items, index));
  }, [index, items]);

  // Editing and capture expand the view through `inline` below; the saved layout stays put.
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
    void leave(onClose);
  }, [busy, leave, onClose]);

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
    void leave(() => onResolveIssue({ ...item, description: caption }));
  }, [busy, caption, leave, item, onResolveIssue]);

  const handleReviewCandidate = useCallback(() => {
    if (!item || busy || !onReviewCandidate) return;
    void leave(() => onReviewCandidate(item));
  }, [busy, leave, item, onReviewCandidate]);

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
    if (!(await flushPendingSave())) {
      setDeleting(false);
      setDeleteConfirmOpen(false);
      return;
    }

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

  // Derived above the early return so the hooks below are not called conditionally.
  const canEditVideoItem = item ? isEditableVideo(item) : false;
  const canEditImageItem = item ? isEditableImage(item) : false;
  const editing = editMode && (canEditVideoItem || canEditImageItem);
  const inline =
    Boolean(onFocusViewChange) && !focusView && !narrow && !editing && !frameCapture.frameMode;
  const editExpanded = editing || frameCapture.frameMode;

  useEffect(() => {
    if (!editExpanded || !onEditExpandedChange) return;
    onEditExpandedChange(true);
    return () => onEditExpandedChange(false);
  }, [editExpanded, onEditExpandedChange]);

  useEffect(() => {
    const goToStep = (step: NonNullable<ReturnType<typeof queueStepFor>>) => {
      if (step === "previous") void leave(onPrevious);
      else if (step === "next") void leave(onNext);
      else if (onGoTo) void leave(() => onGoTo(queueIndexAfter(step, index, items.length)));
    };
    const handleKey = (event: KeyboardEvent) => {
      if (childOverlayOpen || busy) return;
      const outside =
        inline && (!(event.target instanceof Node) || !modalRef.current?.contains(event.target));
      // Beside the gallery, only closing and paging reach past the panel, and never into
      // another widget. Focus stays on the opening card, so Escape must work from there.
      if (outside) {
        const target = event.target instanceof Element ? event.target : null;
        if (
          event.defaultPrevented ||
          getScrollLockDepth() > 0 ||
          isEditableTarget(event.target) ||
          target?.closest(OUTSIDE_ARROW_OWNERS)
        )
          return;
        if (matchesShortcut(event, SHORTCUTS.close)) {
          event.preventDefault();
          closeModal();
          return;
        }
        const step = queueStepFor(event);
        if (!step) return;
        event.preventDefault();
        goToStep(step);
        return;
      }

      // First: the caption editor, where this gets pressed, has already prevented the default.
      if (matchesShortcut(event, SHORTCUTS.saveAndNext)) {
        event.preventDefault();
        void leave(onNext);
        return;
      }
      // A mask surface claims arrows and Delete by preventing the default.
      if (event.defaultPrevented) return;
      if (inline && matchesShortcut(event, SHORTCUTS.close) && getScrollLockDepth() === 0) {
        event.preventDefault();
        closeModal();
        return;
      }
      // A focused scrubber is exempt via isEditableTarget so arrows still step frames.
      if (isEditableTarget(event.target)) return;

      if (matchesShortcut(event, SHORTCUTS.deleteItem)) {
        if (editing || frameCapture.frameMode) return;
        event.preventDefault();
        openDeleteConfirm();
        return;
      }

      const step = queueStepFor(event);
      if (!step) return;
      event.preventDefault();
      goToStep(step);
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [
    busy,
    childOverlayOpen,
    closeModal,
    editing,
    leave,
    inline,
    frameCapture.frameMode,
    index,
    items.length,
    onGoTo,
    onNext,
    onPrevious,
    openDeleteConfirm,
  ]);

  // In frame/edit mode Escape steps back to viewing; ModalShell stands down via escape="none".
  useEscapeKey(frameCapture.exitFrameMode, frameCapture.frameMode && !busy);
  useEscapeKey(videoEdit.exitEditMode, editMode && canEditVideoItem && !busy);
  useEscapeKey(imageEdit.exitEditMode, editMode && canEditImageItem && !busy);

  if (!item) return null;

  const mediaLabel = mediaLabelFor(item);
  const resolution = getResolution(item);
  const captionDisplay = getGalleryItemCaptionDisplay(item, mediaLabel);
  const copyContent = caption;
  const canCopyCaption = copyContent.length > 0;
  const canRestoreBackup = backupCaption !== null && backupCaption.trim() !== caption.trim();
  const canResolveIssue = isResolvableIssueItem(item) && Boolean(onResolveIssue);
  const canReviewCandidate = isCandidateItem(item) && Boolean(onReviewCandidate);
  // Destination folder only; a missing onCopied costs the refresh, not the save.
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
        // The media viewer remains the workspace's base overlay when returning from review.
        nested={false}
        escape={frameCapture.frameMode || editMode ? "none" : "bubble"}
        panelRef={modalRef}
        inline={inline}
        scrollLock="gallery-item-modal-open"
        style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
      >
        {inline && (
          <div
            className="workspace-inspector-resize"
            role="separator"
            aria-label="Caption inspector width"
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={520}
            aria-valuenow={inspectorWidth}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const width = Math.max(
                320,
                Math.min(520, inspectorWidth + (event.key === "ArrowLeft" ? 20 : -20)),
              );
              setInspectorWidth(width);
              writeStored("workspace-inspector-width", String(width));
            }}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const right = modalRef.current?.getBoundingClientRect().right ?? window.innerWidth;
              setInspectorWidth(Math.max(320, Math.min(520, right - event.clientX)));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              writeStored("workspace-inspector-width", String(inspectorWidth));
            }}
          />
        )}
        <header className="gallery-item-modal__header">
          <div className="gallery-item-modal__header-text">
            <h2 className="gallery-item-modal__title" title={item.name}>
              {item.name}
            </h2>
            {inline && (
              <button
                type="button"
                className="gallery-item-modal__step"
                onClick={() => void leave(onPrevious)}
                disabled={busy}
                aria-label="Previous item"
              >
                <Icon icon={iconChevronLeft} />
              </button>
            )}
            <span className="gallery-item-modal__counter">
              {index + 1} / {items.length}
            </span>
            {inline && (
              <button
                type="button"
                className="gallery-item-modal__step"
                onClick={() => void leave(onNext)}
                disabled={busy}
                aria-label="Next item"
              >
                <Icon icon={iconChevronRight} />
              </button>
            )}
          </div>
          <div className="gallery-item-modal__header-actions">
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
                  <Icon icon={iconSquarePen} />
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
                  <Icon icon={iconSquarePen} />
                </button>
              </Tooltip>
            )}
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
                    onClick={() => void leave(() => transfer.openTransferPicker("copy"))}
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
                    onClick={() => void leave(() => transfer.openTransferPicker("move"))}
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
            <div className="gallery-item-modal__presentation-actions">
              {onFocusViewChange && (
                <Tooltip content={focusView ? "Return to caption inspector" : "Expand media view"}>
                  <button
                    type="button"
                    className="gallery-item-modal__expand"
                    aria-label={focusView ? "Return to caption inspector" : "Expand media view"}
                    disabled={busy || editing || frameCapture.frameMode}
                    onClick={() => onFocusViewChange(!focusView)}
                  >
                    <Icon icon={focusView ? iconMinimize : iconExpand} />
                  </button>
                </Tooltip>
              )}
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
          </div>
        </header>

        <div
          className={classNames(
            "gallery-item-modal__stage",
            editing && "gallery-item-modal__stage--editing",
          )}
        >
          {!inline && (
            <button
              type="button"
              className="gallery-item-modal__nav gallery-item-modal__nav--prev"
              onClick={() => void leave(onPrevious)}
              disabled={busy}
              aria-label="Previous item"
            >
              <Icon icon={iconChevronLeft} />
            </button>
          )}

          {itemIsVideo ? (
            <>
              <div className="gallery-item-modal__video-backdrop">
                <video
                  // Editing plays the original, so source and key change with the mode, not just the bytes.
                  key={editMode ? `${item.path}#original` : item.path}
                  ref={videoCapture.videoRef}
                  className="gallery-item-modal__video"
                  style={{
                    opacity: !editMode || videoEdit.activeMediaRef !== standbyVideoRef ? 1 : 0,
                  }}
                  aria-hidden={editMode && videoEdit.activeMediaRef === standbyVideoRef}
                  src={editMode ? videoOriginalUrl(item.path) : galleryItemMediaUrl(item)}
                  // Native timeline would seek behind the capture slider or trim handles.
                  controls={!frameCapture.frameMode && !editMode}
                  autoPlay
                  // Editing loops the trim band itself, and needs `ended` to reach the band's end.
                  loop={!editMode}
                  muted
                  playsInline
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    recordResolution(video.videoWidth, video.videoHeight, item.path);
                    videoCapture.handleLoadedMetadata(video);
                    videoEdit.handleLoadedMetadata(video);
                  }}
                  // Streamed MP4s report Infinity at loadedmetadata and settle later, stranding the slider.
                  onDurationChange={(event) => {
                    videoCapture.handleLoadedMetadata(event.currentTarget);
                    videoEdit.handleLoadedMetadata(event.currentTarget);
                  }}
                />
                {editMode && canEditVideoItem && (
                  <video
                    key={`${item.path}#standby`}
                    ref={standbyVideoRef}
                    className="gallery-item-modal__video gallery-item-modal__video--standby"
                    style={{ opacity: videoEdit.activeMediaRef === standbyVideoRef ? 1 : 0 }}
                    aria-hidden={videoEdit.activeMediaRef !== standbyVideoRef}
                    src={videoOriginalUrl(item.path)}
                    preload="auto"
                    muted
                    playsInline
                  />
                )}
              </div>
              {editMode && canEditVideoItem && (
                <AdjustCanvas
                  key={item.path}
                  mediaRef={videoEdit.activeMediaRef}
                  sourceWidth={videoEdit.sourceWidth}
                  sourceHeight={videoEdit.sourceHeight}
                  crop={videoEdit.draft.crop}
                  scale={videoEdit.draft.scale}
                  controls={videoEdit.adjust}
                  onPictureChange={setVideoPicture}
                />
              )}
              {editMode && videoEdit.draft.masks.length > 0 && !videoEdit.adjust.zoomed && (
                <MaskOverlay
                  mediaRef={videoEdit.activeMediaRef}
                  src={videoOriginalUrl(item.path)}
                  masks={videoEdit.draft.masks}
                  selectedId={videoEdit.selectedMaskId}
                  sourceWidth={videoEdit.sourceWidth}
                  sourceHeight={videoEdit.sourceHeight}
                  disabled={busy}
                  interactive={videoEdit.maskActive}
                  picture={videoPicture}
                  onSelect={videoEdit.selectMask}
                  onChange={videoEdit.setMaskRect}
                  onRemove={videoEdit.removeMask}
                />
              )}
              {editMode && videoEdit.cropActive && (
                <CropOverlay
                  mediaRef={videoEdit.activeMediaRef}
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
            <ImageEditStage
              edit={imageEdit}
              src={imageOriginalUrl(item.path)}
              alt={item.name}
              disabled={busy}
            />
          ) : (
            <ZoomableImage
              // Frame mode swaps in a still; a leftover GIF zoom would apply to a differently decoded image.
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

          {!inline && (
            <button
              type="button"
              className="gallery-item-modal__nav gallery-item-modal__nav--next"
              onClick={() => void leave(onNext)}
              disabled={busy}
              aria-label="Next item"
            >
              <Icon icon={iconChevronRight} />
            </button>
          )}
        </div>

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

        {!editMode && (
          <>
            <MediaInfoBar
              className="gallery-item-modal__meta"
              item={item}
              resolution={resolution}
              hasComfyWorkflow={hasComfyWorkflow}
              onInspectComfyWorkflow={() => setComfyWorkflowOpen(true)}
            />
            <footer className="gallery-item-modal__footer">
              <div className="gallery-item-modal__caption-editor">
                <div className="gallery-item-modal__caption-toolbar">
                  <div className="gallery-item-modal__caption-heading">
                    <label
                      htmlFor="gallery-item-caption"
                      className="gallery-item-modal__caption-label"
                    >
                      Caption
                    </label>
                    <TokenEstimate text={caption} className="gallery-item-modal__caption-tokens" />
                  </div>
                  <div className="gallery-item-modal__caption-actions">
                    {backupCaption !== null && (
                      <button
                        type="button"
                        className="gallery-item-modal__caption-action"
                        onClick={() => handleCaptionChange(backupCaption)}
                        disabled={busy || !canRestoreBackup}
                        aria-label={`Restore the backed up caption for ${item.name}`}
                        title="Replace this caption with the copy in .backup"
                      >
                        <Icon
                          icon={iconArchiveRestore}
                          className="gallery-item-modal__caption-action-icon"
                        />
                        Restore backup
                      </button>
                    )}
                    <button
                      type="button"
                      className="gallery-item-modal__caption-action"
                      onClick={revertCaption}
                      disabled={busy || !canRevert}
                      aria-label={`Revert caption changes for ${item.name}`}
                      title="Undo every change made since this file was opened"
                    >
                      <Icon
                        icon={iconRotateCcw}
                        className="gallery-item-modal__caption-action-icon"
                      />
                      Revert
                    </button>
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
                    {canReviewCandidate && (
                      <button
                        type="button"
                        className="gallery-item-modal__caption-action"
                        onClick={handleReviewCandidate}
                        disabled={busy}
                        aria-label={`Review candidate for ${item.name}`}
                        title="Compare the staged candidate against this file"
                      >
                        <Icon
                          icon={iconScanSquare}
                          className="gallery-item-modal__caption-action-icon"
                        />
                        Review candidate
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
                  // Fresh editor per item: CodeMirror maps selection through a document swap.
                  key={item.path}
                  id="gallery-item-caption"
                  completions={captionCompletions}
                  value={caption}
                  placeholder={placeholder}
                  variant={captionDisplay.variant}
                  saveState={saveState}
                  searchQuery={searchQuery}
                  searchRegex={searchRegex}
                  aria-label={`Caption for ${item.name}`}
                  aria-invalid={saveState === "error"}
                  onChange={handleCaptionChange}
                  editable={!leaving}
                />
                <CaptionSaveStatus state={saveState} error={saveError} onRetry={retrySave} />
                {leaveFailed && (
                  <div className="workspace-save-error" role="alert">
                    <p>
                      The caption could not be saved. Retry saving or discard the unsaved changes to
                      continue.
                    </p>
                    <button
                      type="button"
                      className="workspace-button"
                      disabled={leaving}
                      onClick={async () => {
                        if (leavingRef.current) return;
                        leavingRef.current = true;
                        setLeaving(true);
                        const saved = await retrySave();
                        leavingRef.current = false;
                        setLeaving(false);
                        if (saved) {
                          const action = pendingActionRef.current;
                          if (action) await leave(action);
                        }
                      }}
                    >
                      Retry and continue
                    </button>
                    <button
                      type="button"
                      className="workspace-button"
                      disabled={leaving}
                      onClick={() => {
                        const action = pendingActionRef.current;
                        pendingActionRef.current = null;
                        discardCaptionChanges();
                        setLeaveFailed(false);
                        void action?.();
                      }}
                    >
                      Discard and continue
                    </button>
                    <button
                      type="button"
                      className="workspace-button"
                      onClick={() => {
                        pendingActionRef.current = null;
                        setLeaveFailed(false);
                      }}
                    >
                      Keep editing
                    </button>
                  </div>
                )}
              </div>
            </footer>
          </>
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

      {comfyWorkflowOpen && (
        <ComfyWorkflowDialog
          mediaPath={item.path}
          mediaName={item.name}
          onClose={() => setComfyWorkflowOpen(false)}
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
    </>
  );
}
