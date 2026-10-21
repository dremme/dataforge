import { DiscardChangesDialog } from "@/shared/ui/DiscardChangesDialog";
import {
  useCallback,
  useContext,
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
import { InspectorPanel } from "@/shared/ui/InspectorPanel";
import { DialogShell } from "@/shared/ui/DialogShell";
import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
import { useDialogNavigationDraft } from "@/shared/hooks/useDialogNavigationDraft";
import { DialogSuspendedContext } from "@/shared/ui/dialogSuspendedContext";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { matchesShortcut, queueIndexAfter, queueStepFor, SHORTCUTS } from "@/shared/lib/shortcuts";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import {
  deleteMedia,
  openMediaInViewer,
  renameMedia,
  type MediaTransferMode,
} from "@/features/gallery/api/media";
import {
  galleryItemMediaUrl,
  galleryItemWaveformUrl,
  mediaCacheKey,
} from "@/features/gallery/lib/thumbnail";
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
import { useAudioEdit } from "@/features/gallery/hooks/useAudioEdit";
import { audioOriginalWaveformUrl } from "@/features/gallery/api/audioEdit";
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
  iconClapperboard,
  iconCopy,
  iconFileDiff,
  iconFiles,
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
  iconMinimize2,
  iconPencilLine,
} from "@/shared/icons";
import { isResolvableIssueItem } from "@/features/gallery/lib/issues";
import { isCandidateItem } from "@/features/gallery/lib/candidateReview";
import { splitFileName } from "@/features/gallery/lib/fileName";
import { isDuplicateItem } from "@/features/gallery/lib/duplicates";
import {
  isAudio,
  isEditableAudio,
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
  collectAdjacentDialogMediaTargets,
  schedulePrefetchDialogMedia,
} from "@/features/gallery/lib/dialogMediaPrefetch";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { GIF_MP4_FRAME_RATE } from "@/shared/constants";
import { classNames } from "@/shared/lib/classNames";
import { buildCaptionVocabulary } from "@/features/gallery/lib/captionVocabulary";
import { CaptionEditor } from "@/shared/ui/CaptionEditor";
import { CaptionWordDiff } from "@/shared/ui/CaptionWordDiff";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { RenameDialog } from "@/shared/ui/RenameDialog";
import { FileImportOverwriteDialog } from "@/features/folder/components/FileImportOverwriteDialog";
import { CaptionSaveStatus } from "./CaptionSaveStatus";
import { MediaInfoBar } from "./MediaInfoBar";
import { MediaTagList } from "./MediaTagList";
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
import { AudioEditPanel } from "./AudioEditPanel";
import { ZoomableImage } from "./ZoomableImage";
import { AudioWaveform } from "./AudioWaveform";
import { imageOriginalUrl } from "@/features/gallery/api/imageEdit";
import { videoOriginalUrl } from "@/features/gallery/api/videoEdit";
import { evenTrunc } from "@/features/gallery/lib/videoEdit";
import { useVideoEditorLauncher } from "@/features/videoEditor/context/VideoEditorContext";
import { VIDEO_PROJECT_VIDEO_EXTENSIONS } from "@/shared/constants";
import { useChanged } from "@/shared/hooks/useChanged";

const noop = () => {};

function hasExtension(name: string, extensions: readonly string[]): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && extensions.includes(name.slice(dot).toLowerCase());
}

// Widgets outside the inspector that use arrow keys themselves.
const OUTSIDE_ARROW_OWNERS =
  '[role="menu"], [role="listbox"], [role="slider"], [role="separator"], [role="tablist"], select';

interface GalleryItemDialogProps {
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
  /** Renaming stays hidden without it. */
  onRenamed?: (path: string, renamedPath: string) => void;
  onMoved?: (paths: string[]) => void | Promise<void>;
  onCopied?: () => void | Promise<void>;
  onResolveIssue?: (item: GalleryItem) => void;
  onReviewCandidate?: (item: GalleryItem) => void;
  onResolveDuplicate?: (item: GalleryItem) => void;
  focusView?: boolean;
  onFocusViewChange?: (focus: boolean) => void;
  /** Editing or capture expanded a docked view: the gallery is covered, its layout unsaved. */
  onEditExpandedChange?: (expanded: boolean) => void;
  transitionRef?: RefObject<WorkspaceTransition | null>;
  suspended?: boolean;
}

/** The edited sound's pictures, in pixels: the stage's big one and the trim track's strip. */
const AUDIO_STAGE_WAVEFORM_WIDTH = 1200;
const AUDIO_STAGE_WAVEFORM_HEIGHT = 240;
const AUDIO_TRACK_WAVEFORM_HEIGHT = 64;

export function GalleryItemDialog({
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
  onRenamed,
  onMoved,
  onCopied,
  onResolveIssue,
  onReviewCandidate,
  onResolveDuplicate,
  focusView = true,
  onFocusViewChange,
  onEditExpandedChange,
  transitionRef,
  suspended = false,
}: GalleryItemDialogProps) {
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
    hasUnsavedChanges: captionDirty,
    saving: captionSaving,
  } = useGalleryItemCaption({ item, onCaptionSaved });
  const backupCaption = useCaptionBackup(item?.path, hasCaptionBackup);
  const captionCompletions = useMemo(() => buildCaptionVocabulary(items), [items]);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [openingInViewer, setOpeningInViewer] = useState(false);
  const [comparingBackup, setComparingBackup] = useState(false);
  const comparedBackup = comparingBackup ? backupCaption : null;
  const showingBackupDiff = comparedBackup !== null;
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

  const dialogRef = useRef<HTMLDivElement>(null);

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
  const itemIsAudio = item ? isAudio(item) : false;
  const gifFrameCount = useGifFrameCount(item, itemIsGif);

  // Both hooks run unconditionally; hooks cannot be called behind a branch.
  const { videoRef, ...videoCapture } = useVideoFrameCapture({
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
    videoRef,
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioEdit = useAudioEdit({
    item,
    audioRef,
    onEdited: onCopied,
    editMode,
    setEditMode,
  });

  const gifToMp4 = useGifToMp4({ item, onConverted: onCopied });

  const { transferPicker, overwritePrompt, transferring } = transfer;
  const otherWorkBusy =
    leaving || deleting || renaming || transferring !== null || gifToMp4.converting;
  const editApplying = videoEdit.applying || imageEdit.applying || audioEdit.applying;
  const busy = otherWorkBusy || frameCapture.saving || editApplying;
  const parentSuspended = useContext(DialogSuspendedContext);
  const otherOverlayOpen =
    parentSuspended ||
    suspended ||
    deleteConfirmOpen ||
    renameOpen ||
    revertConfirmOpen ||
    comfyWorkflowOpen ||
    transfer.transferDialogOpen ||
    gifToMp4.conflict !== null;
  const activeEdit =
    item && isEditableVideo(item)
      ? videoEdit
      : item && isEditableAudio(item)
        ? audioEdit
        : imageEdit;
  const unsavedEdits = editMode && (activeEdit.dirty || activeEdit.adjust.autoPending);
  useDialogNavigationDraft({
    unsavedChanges: captionDirty,
    blocked: busy,
    save: () => flushPendingSave(true),
    onDiscard: discardCaptionChanges,
  });
  const discard = useDiscardChanges({
    unsavedChanges: unsavedEdits,
    busy,
    suspended: otherOverlayOpen,
    onNavigationDiscard: activeEdit.resetDraft,
  });
  const { request: requestDiscard } = discard;
  const renameDiscard = useDiscardChanges({
    unsavedChanges: unsavedEdits,
    busy,
    suspended: otherOverlayOpen && !renameOpen,
    description: "Your unapplied media edits will be lost when this file is renamed.",
  });
  const { request: requestRename } = renameDiscard;
  const flushAndLeave = useCallback(
    async (action: WorkspaceAction) => {
      if (busy || leavingRef.current) return;
      if (!captionDirty) {
        await action();
        return;
      }
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
    [busy, captionDirty, flushPendingSave],
  );
  const resetEditDraft = activeEdit.resetDraft;
  const leave = useCallback(
    (action: WorkspaceAction) =>
      requestDiscard(async () => {
        if (unsavedEdits) resetEditDraft();
        await flushAndLeave(action);
      }),
    [requestDiscard, flushAndLeave, resetEditDraft, unsavedEdits],
  );

  useEffect(() => {
    if (!transitionRef) return;
    transitionRef.current = leave;
    return () => {
      if (transitionRef.current === leave) transitionRef.current = null;
    };
  }, [leave, transitionRef]);
  // Frame mode stays out: this feeds DialogShell.suspended, which would make the slider inert.
  const childOverlayOpen = otherOverlayOpen || discard.confirming || renameDiscard.confirming;
  const canTransfer = Boolean(currentFolder) && Boolean(onMoved) && Boolean(onCopied);

  // Transfer state stays out: a move advances the item while finally is pending, re-enabling early.
  if (useChanged(item?.path)) {
    setDeleteConfirmOpen(false);
    setDeleting(false);
    setRenameOpen(false);
    setRenaming(false);
    setRenameError(null);
    setOpeningInViewer(false);
    setViewerError(null);
    setComfyWorkflowOpen(false);
    setComparingBackup(false);
  }

  // Drop sticky capture on a still or missing destination so the bar needs no scrubber.
  if (frameMode && (!item || !currentFolder || (!itemIsVideo && !itemIsGif))) {
    setFrameMode(false);
  }

  if (
    (editMode || revertConfirmOpen) &&
    (!item || (!isEditableVideo(item) && !isEditableImage(item) && !isEditableAudio(item)))
  ) {
    setEditMode(false);
    setRevertConfirmOpen(false);
  }

  useEffect(() => {
    return schedulePrefetchDialogMedia(collectAdjacentDialogMediaTargets(items, index));
  }, [index, items]);

  // Editing and capture expand the view through `inline` below; the saved layout stays put.
  const toggleFrameMode = useCallback(() => {
    void requestDiscard(() => {
      setEditMode(false);
      frameCapture.toggleFrameMode();
    });
  }, [requestDiscard, frameCapture]);

  const toggleVideoEditMode = useCallback(() => {
    void requestDiscard(() => {
      setFrameMode(false);
      videoEdit.toggleEditMode();
    });
  }, [requestDiscard, videoEdit]);

  const toggleAudioEditMode = useCallback(() => {
    void requestDiscard(() => {
      setFrameMode(false);
      audioEdit.toggleEditMode();
    });
  }, [requestDiscard, audioEdit]);

  const toggleImageEditMode = useCallback(() => {
    void requestDiscard(() => {
      setFrameMode(false);
      imageEdit.toggleEditMode();
    });
  }, [requestDiscard, imageEdit]);

  const exitEditMode = useCallback(() => {
    void requestDiscard(activeEdit.exitEditMode);
  }, [activeEdit.exitEditMode, requestDiscard]);

  const { copyState, copyLabel, copyText } = useCopyFeedback();

  const closeDialog = useCallback(() => {
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

  const openRename = useCallback(() => {
    if (busy) return;
    setRenameError(null);
    setRenameOpen(true);
  }, [busy]);

  const cancelRename = useCallback(() => {
    if (renaming) return;
    setRenameOpen(false);
    setRenameError(null);
  }, [renaming]);

  const confirmRename = useCallback(
    (name: string) =>
      requestRename(async () => {
        if (!item || renaming) return;

        setRenaming(true);
        setRenameError(null);
        // A caption saved after the rename would write a file under the old name.
        if (!(await flushPendingSave(true))) {
          setRenaming(false);
          setRenameError("The caption could not be saved. Try renaming again to retry the save.");
          return;
        }

        try {
          const result = await renameMedia(item.path, name);
          setRenameOpen(false);
          onRenamed?.(item.path, result.destination);
        } catch (error) {
          setRenameError(formatApiError(error));
        } finally {
          setRenaming(false);
        }
      }),
    [requestRename, flushPendingSave, item, onRenamed, renaming],
  );

  const handleResolveIssue = useCallback(() => {
    if (!item || busy || !onResolveIssue) return;
    void leave(() => onResolveIssue({ ...item, description: caption }));
  }, [busy, caption, leave, item, onResolveIssue]);

  const handleReviewCandidate = useCallback(() => {
    if (!item || busy || !onReviewCandidate) return;
    void leave(() => onReviewCandidate(item));
  }, [busy, leave, item, onReviewCandidate]);

  const handleResolveDuplicate = useCallback(() => {
    if (!item || busy || !onResolveDuplicate) return;
    void leave(() => onResolveDuplicate(item));
  }, [busy, leave, item, onResolveDuplicate]);

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
  const videoEditor = useVideoEditorLauncher();
  const canOpenInVideoEditor = Boolean(
    videoEditor && item && isVideo(item) && hasExtension(item.name, VIDEO_PROJECT_VIDEO_EXTENSIONS),
  );
  const canEditImageItem = item ? isEditableImage(item) : false;
  const canEditAudioItem = item ? isEditableAudio(item) : false;
  const editing = editMode && (canEditVideoItem || canEditImageItem || canEditAudioItem);
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
      if (items.length < 2) return;
      if (step === "previous") void leave(onPrevious);
      else if (step === "next") void leave(onNext);
      else {
        const target = queueIndexAfter(step, index, items.length);
        if (onGoTo && target !== index) void leave(() => onGoTo(target));
      }
    };
    // Escape leaves the backup comparison before it closes anything; edit and frame modes
    // take Escape first, so one press never leaves both.
    const leavesComparison = (event: KeyboardEvent) => {
      if (!showingBackupDiff || editing || frameCapture.frameMode) return false;
      if (!matchesShortcut(event, SHORTCUTS.close)) return false;
      event.preventDefault();
      setComparingBackup(false);
      return true;
    };
    const handleKey = (event: KeyboardEvent) => {
      if (childOverlayOpen || busy) return;
      const outside =
        inline && (!(event.target instanceof Node) || !dialogRef.current?.contains(event.target));
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
        if (leavesComparison(event)) return;
        if (matchesShortcut(event, SHORTCUTS.close)) {
          event.preventDefault();
          closeDialog();
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
        if (items.length > 1) void leave(onNext);
        else void flushPendingSave();
        return;
      }
      // A mask surface claims arrows and Delete by preventing the default.
      if (event.defaultPrevented) return;
      if (leavesComparison(event)) return;
      if (inline && matchesShortcut(event, SHORTCUTS.close) && getScrollLockDepth() === 0) {
        event.preventDefault();
        closeDialog();
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
    closeDialog,
    editing,
    leave,
    inline,
    frameCapture.frameMode,
    flushPendingSave,
    index,
    items.length,
    onGoTo,
    onNext,
    onPrevious,
    openDeleteConfirm,
    showingBackupDiff,
  ]);

  // In frame/edit mode Escape steps back to viewing; DialogShell stands down via escape="none".
  useEscapeKey(frameCapture.exitFrameMode, frameCapture.frameMode && !busy && !childOverlayOpen);
  useEscapeKey(exitEditMode, editing && !busy && !childOverlayOpen);

  if (!item) return null;

  // The original's sound: what the trims and the preview are measured against.
  const originalWaveform = (width: number, height: number) =>
    canEditAudioItem && audioEdit.ready
      ? audioOriginalWaveformUrl(
          item.path,
          audioEdit.duration,
          width,
          height,
          `${mediaCacheKey(item.modified_at, item.size) ?? ""}-${audioEdit.hasBackup ? 1 : 0}`,
        )
      : undefined;
  const audioStageWaveform = originalWaveform(
    AUDIO_STAGE_WAVEFORM_WIDTH,
    AUDIO_STAGE_WAVEFORM_HEIGHT,
  );
  const audioTrackWaveform = originalWaveform(
    AUDIO_STAGE_WAVEFORM_WIDTH,
    AUDIO_TRACK_WAVEFORM_HEIGHT,
  );

  const mediaLabel = mediaLabelFor(item);
  const nameParts = splitFileName(item.name);
  const resolution = getResolution(item);
  const captionDisplay = getGalleryItemCaptionDisplay(item, mediaLabel);
  const copyContent = caption;
  const canCopyCaption = copyContent.length > 0;
  const canRestoreBackup = backupCaption !== null && backupCaption.trim() !== caption.trim();
  const canResolveIssue = isResolvableIssueItem(item) && Boolean(onResolveIssue);
  const canReviewCandidate = isCandidateItem(item) && Boolean(onReviewCandidate);
  const canResolveDuplicate = isDuplicateItem(item) && Boolean(onResolveDuplicate);
  // Destination folder only; a missing onCopied costs the refresh, not the save.
  const canCaptureFrame = (itemIsVideo || itemIsGif) && Boolean(currentFolder);
  const placeholder =
    captionDisplay.variant === "success" ? "Add a caption..." : captionDisplay.message;

  const Surface = inline ? InspectorPanel : DialogShell;
  return (
    <DialogSuspendedContext.Provider value={parentSuspended || leaving}>
      <Surface
        block="gallery-item-dialog"
        label={`Viewing ${item.name}`}
        onClose={closeDialog}
        busy={busy}
        suspended={childOverlayOpen}
        escape={frameCapture.frameMode || editMode || showingBackupDiff ? "none" : "close"}
        panelRef={dialogRef}
        scrollLock="gallery-item-dialog-open"
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
              const right = dialogRef.current?.getBoundingClientRect().right ?? window.innerWidth;
              setInspectorWidth(Math.max(320, Math.min(520, right - event.clientX)));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              writeStored("workspace-inspector-width", String(inspectorWidth));
            }}
          />
        )}
        <header className="gallery-item-dialog__header">
          <div className="gallery-item-dialog__header-text">
            <h2 className="gallery-item-dialog__title" title={item.name}>
              {item.name}
            </h2>
            {inline && (
              <button
                type="button"
                className="gallery-item-dialog__step"
                onClick={() => void leave(onPrevious)}
                disabled={busy}
                aria-label="Previous item"
              >
                <Icon icon={iconChevronLeft} />
              </button>
            )}
            <span className="gallery-item-dialog__counter">
              {index + 1} / {items.length}
            </span>
            {inline && (
              <button
                type="button"
                className="gallery-item-dialog__step"
                onClick={() => void leave(onNext)}
                disabled={busy}
                aria-label="Next item"
              >
                <Icon icon={iconChevronRight} />
              </button>
            )}
          </div>
          <div className="gallery-item-dialog__header-actions">
            {canOpenInVideoEditor && (
              <Tooltip content="Open in video editor">
                <button
                  type="button"
                  className="gallery-item-dialog__video-editor"
                  onClick={() => void leave(() => videoEditor?.open(item.path))}
                  disabled={busy || editing}
                  aria-label={`Open ${item.name} in the video editor`}
                >
                  <Icon icon={iconClapperboard} />
                </button>
              </Tooltip>
            )}
            {canEditVideoItem && (
              <Tooltip content={editMode ? "Exit video editing" : "Edit video"}>
                <button
                  type="button"
                  className={classNames(
                    "gallery-item-dialog__edit-toggle",
                    editMode && "gallery-item-dialog__edit-toggle--active",
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
            {canEditAudioItem && (
              <Tooltip content={editMode ? "Exit audio editing" : "Edit audio"}>
                <button
                  type="button"
                  className={classNames(
                    "gallery-item-dialog__edit-toggle",
                    editMode && "gallery-item-dialog__edit-toggle--active",
                  )}
                  onClick={toggleAudioEditMode}
                  disabled={busy}
                  aria-pressed={editMode}
                  aria-label={
                    editMode ? `Exit audio editing for ${item.name}` : `Edit ${item.name}`
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
                    "gallery-item-dialog__edit-toggle",
                    editMode && "gallery-item-dialog__edit-toggle--active",
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
            {!isMotion(item) && !itemIsAudio && (
              <Tooltip content={viewerError ?? "Open in image preview"}>
                <button
                  type="button"
                  className="gallery-item-dialog__preview"
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
                  className="gallery-item-dialog__convert"
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
                    "gallery-item-dialog__frame-toggle",
                    frameCapture.frameMode && "gallery-item-dialog__frame-toggle--active",
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
                    className="gallery-item-dialog__copy"
                    onClick={() => void flushAndLeave(() => transfer.openTransferPicker("copy"))}
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
                    className="gallery-item-dialog__move"
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
            {onRenamed && (
              <Tooltip content={"Rename file"}>
                <button
                  type="button"
                  className="gallery-item-dialog__rename"
                  onClick={openRename}
                  disabled={busy}
                  aria-label={`Rename ${item.name}`}
                >
                  <Icon icon={iconPencilLine} />
                </button>
              </Tooltip>
            )}
            <Tooltip content={"Delete file"}>
              <button
                type="button"
                className="gallery-item-dialog__delete"
                onClick={openDeleteConfirm}
                disabled={busy}
                aria-label={`Delete ${item.name}`}
              >
                <Icon icon={iconTrash2} />
              </button>
            </Tooltip>
            <div className="gallery-item-dialog__presentation-actions">
              {onFocusViewChange && (
                <Tooltip
                  content={focusView ? "Minimize to caption inspector" : "Expand media view"}
                >
                  <button
                    type="button"
                    className="gallery-item-dialog__expand"
                    aria-label={focusView ? "Minimize to caption inspector" : "Expand media view"}
                    disabled={busy || editing || frameCapture.frameMode}
                    onClick={() => onFocusViewChange(!focusView)}
                  >
                    <Icon icon={focusView ? iconMinimize2 : iconExpand} />
                  </button>
                </Tooltip>
              )}
              <button
                type="button"
                className="gallery-item-dialog__close"
                onClick={closeDialog}
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
            "gallery-item-dialog__stage",
            editing && "gallery-item-dialog__stage--editing",
          )}
        >
          {!inline && (
            <button
              type="button"
              className="gallery-item-dialog__nav gallery-item-dialog__nav--prev"
              onClick={() => void leave(onPrevious)}
              disabled={busy}
              aria-label="Previous item"
            >
              <Icon icon={iconChevronLeft} />
            </button>
          )}

          {itemIsVideo ? (
            <>
              <div className="gallery-item-dialog__video-backdrop">
                <video
                  // Editing plays the original, so source and key change with the mode, not just the bytes.
                  key={editMode ? `${item.path}#original` : item.path}
                  ref={videoRef}
                  className="gallery-item-dialog__video"
                  style={{
                    opacity: !editMode || videoEdit.activeMediaRef !== standbyVideoRef ? 1 : 0,
                  }}
                  aria-hidden={editMode && videoEdit.activeMediaRef === standbyVideoRef}
                  src={editMode ? videoOriginalUrl(item.path) : galleryItemMediaUrl(item)}
                  // Native timeline would seek behind the capture slider or trim handles.
                  controls={!frameCapture.frameMode && !editMode}
                  autoPlay
                  // Editing loops the trim band itself, and needs `ended` to reach the band's end.
                  // Capture: Chrome wraps a looping video to 0 when seeking into its last frame.
                  loop={!editMode && !frameCapture.frameMode}
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
                    className="gallery-item-dialog__video gallery-item-dialog__video--standby"
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
          ) : itemIsAudio && editMode && canEditAudioItem ? (
            <div className="gallery-item-dialog__audio">
              <AudioWaveform
                src={audioStageWaveform ?? galleryItemWaveformUrl(item)}
                className="gallery-item-dialog__waveform"
              />
              <audio
                // The hook sets the source: the original, or the proxy that carries its effects.
                key={`${item.path}#edit`}
                ref={audioRef}
                preload="auto"
                onLoadedMetadata={(event) => audioEdit.handleLoadedMetadata(event.currentTarget)}
              />
            </div>
          ) : itemIsAudio ? (
            <div className="gallery-item-dialog__audio">
              <AudioWaveform
                src={galleryItemWaveformUrl(item)}
                className="gallery-item-dialog__waveform"
              />
              <audio
                // Paging swaps the element, so the next clip starts from the top, not mid-play.
                key={item.path}
                className="gallery-item-dialog__audio-player"
                src={galleryItemMediaUrl(item)}
                controls
                preload="metadata"
              />
            </div>
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
              className="gallery-item-dialog__media-wrap"
              imgClassName="gallery-item-dialog__img"
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
              className="gallery-item-dialog__nav gallery-item-dialog__nav--next"
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
              max={videoCapture.sliderMax}
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

        {editMode && canEditAudioItem && (
          <AudioEditPanel
            edit={audioEdit}
            waveformUrl={audioTrackWaveform}
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
              className="gallery-item-dialog__meta"
              item={item}
              resolution={resolution}
              hasComfyWorkflow={hasComfyWorkflow}
              onInspectComfyWorkflow={() => setComfyWorkflowOpen(true)}
            />
            {!inline && <MediaTagList tags={item.tags} />}
            <footer className="gallery-item-dialog__footer">
              <div className="gallery-item-dialog__caption-editor">
                <div className="gallery-item-dialog__caption-toolbar">
                  <div className="gallery-item-dialog__caption-heading">
                    <label
                      htmlFor="gallery-item-caption"
                      className="gallery-item-dialog__caption-label"
                    >
                      Caption
                    </label>
                    <TokenEstimate text={caption} className="gallery-item-dialog__caption-tokens" />
                  </div>
                  <div className="gallery-item-dialog__caption-actions">
                    {backupCaption !== null && (
                      <button
                        type="button"
                        className="gallery-item-dialog__caption-action"
                        onClick={() => setComparingBackup((current) => !current)}
                        // The label names the action, not a state: a toggle that renames itself
                        // would contradict aria-pressed.
                        aria-label={
                          showingBackupDiff
                            ? `Back to editing the caption for ${item.name}`
                            : `Compare the caption for ${item.name} with its backup`
                        }
                        title={
                          showingBackupDiff
                            ? "Close the comparison and edit the caption"
                            : "Show what restoring the copy in .backup would change"
                        }
                      >
                        <Icon
                          icon={showingBackupDiff ? iconPencilLine : iconFileDiff}
                          className="gallery-item-dialog__caption-action-icon"
                        />
                        {showingBackupDiff ? "Back to editing" : "Compare backup"}
                      </button>
                    )}
                    {comparedBackup !== null && (
                      <button
                        type="button"
                        className="gallery-item-dialog__caption-action"
                        onClick={() => {
                          handleCaptionChange(comparedBackup);
                          setComparingBackup(false);
                        }}
                        disabled={busy || !canRestoreBackup}
                        aria-label={`Restore the backed up caption for ${item.name}`}
                        title="Replace this caption with the copy in .backup"
                      >
                        <Icon
                          icon={iconArchiveRestore}
                          className="gallery-item-dialog__caption-action-icon"
                        />
                        Use backup
                      </button>
                    )}
                    {/* Revert and Copy act on the editor's text, which the comparison hides. */}
                    {!showingBackupDiff && (
                      <button
                        type="button"
                        className="gallery-item-dialog__caption-action"
                        onClick={revertCaption}
                        disabled={busy || !canRevert}
                        aria-label={`Revert caption changes for ${item.name}`}
                        title="Undo every change made since this file was opened"
                      >
                        <Icon
                          icon={iconRotateCcw}
                          className="gallery-item-dialog__caption-action-icon"
                        />
                        Revert
                      </button>
                    )}
                    {canResolveIssue && (
                      <button
                        type="button"
                        className="gallery-item-dialog__caption-action gallery-item-dialog__caption-action--issue"
                        onClick={handleResolveIssue}
                        disabled={busy}
                        aria-label={`Resolve caption issue for ${item.name}`}
                      >
                        <Icon
                          icon={iconMessageCheck}
                          className="gallery-item-dialog__caption-action-icon"
                        />
                        Resolve issue
                      </button>
                    )}
                    {canReviewCandidate && (
                      <button
                        type="button"
                        className="gallery-item-dialog__caption-action"
                        onClick={handleReviewCandidate}
                        disabled={busy}
                        aria-label={`Review candidate for ${item.name}`}
                        title="Compare the staged candidate against this file"
                      >
                        <Icon
                          icon={iconScanSquare}
                          className="gallery-item-dialog__caption-action-icon"
                        />
                        Review candidate
                      </button>
                    )}
                    {canResolveDuplicate && (
                      <button
                        type="button"
                        className="gallery-item-dialog__caption-action"
                        onClick={handleResolveDuplicate}
                        disabled={busy}
                        aria-label={`Resolve duplicate for ${item.name}`}
                        title="Compare this file with its duplicates and keep one"
                      >
                        <Icon
                          icon={iconFiles}
                          className="gallery-item-dialog__caption-action-icon"
                        />
                        Resolve duplicate
                      </button>
                    )}
                    {!showingBackupDiff && (
                      <button
                        type="button"
                        className={classNames(
                          "gallery-item-dialog__caption-action",
                          copyState === "copied" && "gallery-item-dialog__caption-action--copied",
                          copyState === "error" && "gallery-item-dialog__caption-action--error",
                        )}
                        onClick={() => {
                          void copyText(copyContent);
                        }}
                        disabled={!canCopyCaption}
                        aria-label={copyLabel}
                      >
                        <Icon
                          icon={iconCopy}
                          className="gallery-item-dialog__caption-action-icon"
                        />
                        {copyLabel}
                      </button>
                    )}
                  </div>
                </div>
                {comparedBackup !== null && (
                  <div
                    className="gallery-item-dialog__caption-compare"
                    role="region"
                    aria-label={`Caption compared with its backup for ${item.name}`}
                    tabIndex={0}
                  >
                    {canRestoreBackup ? (
                      <CaptionWordDiff before={caption.trim()} after={comparedBackup.trim()} />
                    ) : (
                      <p className="gallery-item-dialog__caption-compare-note">
                        Matches the backup.
                      </p>
                    )}
                  </div>
                )}
                <CaptionEditor
                  // Fresh editor per item: CodeMirror maps selection through a document swap.
                  key={item.path}
                  id="gallery-item-caption"
                  // Hidden, not unmounted, so comparing keeps the editor's undo history.
                  className={showingBackupDiff ? "gallery-item-dialog__hidden-editor" : undefined}
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
                      disabled={leaving || captionSaving}
                      onClick={() => {
                        if (captionSaving) return;
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
      </Surface>
      {discard.promptProps && <DiscardChangesDialog {...discard.promptProps} />}
      {renameDiscard.promptProps && <DiscardChangesDialog {...renameDiscard.promptProps} />}

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

      {renameOpen && (
        <RenameDialog
          title="Rename file"
          description={
            <span>
              Renames <strong>{item.name}</strong> together with its captions and other related
              files.
              {nameParts.extension && (
                <>
                  {" "}
                  The extension <strong>{nameParts.extension}</strong> stays.
                </>
              )}
            </span>
          }
          fieldLabel="File name"
          initialName={nameParts.stem}
          busy={renaming}
          suspended={renameDiscard.confirming}
          error={renameError}
          onConfirm={(name) => {
            void confirmRename(name);
          }}
          onCancel={cancelRename}
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
          busy={editApplying}
          onConfirm={() => {
            setRevertConfirmOpen(false);
            if (canEditVideoItem) videoEdit.revert();
            else if (canEditAudioItem) audioEdit.revert();
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
    </DialogSuspendedContext.Provider>
  );
}
