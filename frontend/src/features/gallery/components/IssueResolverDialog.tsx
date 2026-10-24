import { DiscardChangesDialog } from "@/shared/ui/DiscardChangesDialog";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DialogSuspendedContext } from "@/shared/ui/dialogSuspendedContext";
import { saveCaption } from "@/features/gallery/api/captions";
import { openMediaInViewer } from "@/features/gallery/api/media";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import { formatApiError, isApiErrorCode } from "@/shared/api/http";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { matchesShortcut, queueIndexAfter, queueStepFor, SHORTCUTS } from "@/shared/lib/shortcuts";
import { flaggedCaptionPhrases } from "@/features/gallery/lib/issues";
import { useGalleryItemCaption } from "@/features/gallery/hooks/useGalleryItemCaption";
import { useMediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import { useComfyWorkflowFlag } from "@/features/gallery/hooks/useComfyWorkflowFlag";
import { isMotion, isVideo, mediaLabelFor } from "@/features/gallery/lib/itemKind";
import {
  collectAdjacentDialogMediaTargets,
  schedulePrefetchDialogMedia,
} from "@/features/gallery/lib/dialogMediaPrefetch";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import {
  iconArrowUpRight,
  iconCircleCheck,
  iconLoader2,
  iconTriangleAlert,
  iconX,
} from "@/shared/icons";
import { buildCaptionVocabulary } from "@/features/gallery/lib/captionVocabulary";
import { CaptionEditor } from "@/shared/ui/CaptionEditor";
import { DialogButton } from "@/shared/ui/Dialog";
import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
import { Icon } from "@/shared/ui/Icon";
import { DialogShell } from "@/shared/ui/DialogShell";
import { TokenEstimate } from "@/shared/ui/TokenEstimate";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ZoomableImage } from "./ZoomableImage";
import { MediaInfoBar } from "./MediaInfoBar";
import { ComfyWorkflowDialog } from "./ComfyWorkflowDialog";
import { useChanged } from "@/shared/hooks/useChanged";

interface IssueGroup {
  label: string;
  entries: string[];
}

function issueGroups(fixes: string[], ruleHits: string[], resolved: boolean): IssueGroup[] {
  const groups = [
    { label: resolved ? "Applied changes" : "Suggested changes", entries: fixes },
    { label: "Rule hits", entries: ruleHits },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

function cleanFindings(findings: readonly string[] | undefined): string[] {
  return (findings ?? []).map((finding) => finding.trim()).filter(Boolean);
}

interface IssueResolverDialogProps {
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onCaptionSaved: (path: string, update: CaptionSaveResponse) => void;
}

export function IssueResolverDialog({
  items,
  index,
  onClose,
  onIndexChange,
  onCaptionSaved,
}: IssueResolverDialogProps) {
  const [queue] = useState(() => items);
  const item = queue[index];
  const hasComfyWorkflow = useComfyWorkflowFlag(item?.path);
  const [comfyWorkflowOpen, setComfyWorkflowOpen] = useState(false);
  const { recordResolution, getResolution } = useMediaResolution();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Queue is frozen at mount, so a resolved entry keeps its fixes unless this records them.
  const [resolvedPaths, setResolvedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [openingInViewer, setOpeningInViewer] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const { caption, handleCaptionChange, hasUnsavedChanges, captionLocked, baseRevisionFor } =
    useGalleryItemCaption({
      item,
      onCaptionSaved,
      autoSave: false,
    });
  const parentSuspended = useContext(DialogSuspendedContext);
  const discard = useDiscardChanges({
    unsavedChanges: hasUnsavedChanges,
    busy: saving,
    suspended: comfyWorkflowOpen,
    onNavigationDiscard: onClose,
  });
  const { request: requestDiscard } = discard;

  if (useChanged(item?.path)) {
    setComfyWorkflowOpen(false);
    setSaveError(null);
    setSaving(false);
    setOpeningInViewer(false);
    setViewerError(null);
  }

  useEffect(() => {
    return schedulePrefetchDialogMedia(collectAdjacentDialogMediaTargets(queue, index));
  }, [index, queue]);

  // Above the early return: the highlight terms below derive from these through a hook.
  const fixes = useMemo(() => cleanFindings(item?.issue_fixes), [item?.issue_fixes]);
  const ruleHits = useMemo(() => cleanFindings(item?.rule_findings), [item?.rule_findings]);
  const flaggedPhrases = useMemo(
    () => flaggedCaptionPhrases([...fixes, ...ruleHits]),
    [fixes, ruleHits],
  );
  const captionCompletions = useMemo(() => buildCaptionVocabulary(queue), [queue]);

  const closeDialog = useCallback(() => {
    void requestDiscard(onClose);
  }, [requestDiscard, onClose]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= queue.length || next === index) return;
      void requestDiscard(() => onIndexChange(next));
    },
    [requestDiscard, index, onIndexChange, queue.length],
  );

  const handleNext = useCallback(() => {
    goTo(index + 1);
  }, [goTo, index]);

  const handlePrevious = useCallback(() => {
    goTo(index - 1);
  }, [goTo, index]);

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
    setSaveError(null);

    try {
      const result = await saveCaption(item.path, caption.trim(), {
        baseRevision: baseRevisionFor(item.path),
        resolveIssue: true,
      });
      onCaptionSaved(item.path, result);
      setResolvedPaths((current) => new Set(current).add(item.path));

      if (index < queue.length - 1) {
        onIndexChange(index + 1);
      } else {
        onClose();
      }
    } catch (error) {
      setSaveError(
        isApiErrorCode(error, "caption_conflict")
          ? "The caption changed elsewhere since it was opened, so it was not saved."
          : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }, [
    baseRevisionFor,
    caption,
    index,
    item,
    onCaptionSaved,
    onClose,
    onIndexChange,
    queue.length,
    saving,
  ]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (saving || comfyWorkflowOpen || discard.confirming || parentSuspended) return;

      // Checked before the editable guard: the caption editor is where this gets pressed.
      if (matchesShortcut(event, SHORTCUTS.resolveOrAccept)) {
        event.preventDefault();
        void handleResolve();
        return;
      }
      if (isEditableTarget(event.target)) return;

      const step = queueStepFor(event);
      if (!step) return;
      event.preventDefault();
      const target = queueIndexAfter(step, index, queue.length);
      goTo(target);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    comfyWorkflowOpen,
    discard.confirming,
    parentSuspended,
    goTo,
    handleResolve,
    index,
    queue.length,
    saving,
  ]);

  if (!item) return null;

  const itemIsVideo = isVideo(item);
  const mediaLabel = mediaLabelFor(item);
  const captionDisplay = getGalleryItemCaptionDisplay(item, mediaLabel);
  const resolution = getResolution(item);
  const placeholder =
    captionDisplay.variant === "success" ? "Add a caption..." : captionDisplay.message;
  const alreadyResolved = resolvedPaths.has(item.path);
  const groups = issueGroups(fixes, ruleHits, alreadyResolved);

  return (
    <DialogShell
      block="issue-resolver-dialog"
      label={`Resolve caption issue for ${item.name}`}
      onClose={closeDialog}
      busy={saving}
      suspended={comfyWorkflowOpen || discard.confirming}
      scrollLock="issue-resolver-dialog-open"
    >
      <header className="issue-resolver-dialog__header">
        <div className="issue-resolver-dialog__header-text">
          <h2 className="issue-resolver-dialog__title">Resolve caption issues</h2>
          <span className="issue-resolver-dialog__counter">
            {index + 1} / {queue.length}
          </span>
        </div>
        <div className="issue-resolver-dialog__header-actions">
          {!isMotion(item) && (
            <Tooltip content={viewerError ?? "Open in image preview"}>
              <button
                type="button"
                className="issue-resolver-dialog__preview"
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
            className="issue-resolver-dialog__close"
            onClick={closeDialog}
            disabled={saving}
            aria-label="Close"
          >
            <Icon icon={iconX} />
          </button>
        </div>
      </header>

      <div className="issue-resolver-dialog__body">
        <div className="issue-resolver-dialog__stage">
          {itemIsVideo ? (
            <video
              key={item.path}
              className="issue-resolver-dialog__video"
              src={galleryItemMediaUrl(item)}
              controls
              // Loop + muted so autoplay is permitted rather than blocked.
              autoPlay
              loop
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
              className="issue-resolver-dialog__media-wrap"
              imgClassName="issue-resolver-dialog__img"
              src={galleryItemMediaUrl(item)}
              alt={item.name}
              onLoad={(event) => {
                const img = event.currentTarget;
                recordResolution(img.naturalWidth, img.naturalHeight, item.path);
              }}
            />
          )}
        </div>

        <MediaInfoBar
          item={item}
          resolution={resolution}
          className="issue-resolver-dialog__meta"
          role="group"
          hasComfyWorkflow={hasComfyWorkflow}
          onInspectComfyWorkflow={() => setComfyWorkflowOpen(true)}
        />
        <div className="issue-resolver-dialog__details" data-scroll-lock-allow>
          <p className="issue-resolver-dialog__file-name" title={item.name}>
            {item.name}
          </p>
          <div
            className={classNames(
              "issue-resolver-dialog__issue-card",
              alreadyResolved && "issue-resolver-dialog__issue-card--resolved",
            )}
          >
            <div className="issue-resolver-dialog__issue-row">
              <Icon
                icon={alreadyResolved ? iconCircleCheck : iconTriangleAlert}
                className="issue-resolver-dialog__issue-icon"
              />
              <div className="issue-resolver-dialog__issue-content">
                {groups.map((group) => (
                  <section key={group.label} className="issue-resolver-dialog__issue-group">
                    <span className="issue-resolver-dialog__issue-label">{group.label}</span>
                    <ol className="issue-resolver-dialog__issue-list">
                      {group.entries.map((entry) => (
                        <li key={entry} className="issue-resolver-dialog__issue-text">
                          {entry}
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
                {groups.length === 0 && (
                  <section className="issue-resolver-dialog__issue-group">
                    <span className="issue-resolver-dialog__issue-label">
                      {alreadyResolved ? "Resolved" : "Issue"}
                    </span>
                    <p className="issue-resolver-dialog__issue-text">
                      {alreadyResolved ? "The caption was saved." : "Error in issue file"}
                    </p>
                  </section>
                )}
              </div>
            </div>
          </div>

          <div className="issue-resolver-dialog__caption-editor">
            <div className="issue-resolver-dialog__caption-heading">
              <label
                htmlFor="issue-resolver-caption"
                className="issue-resolver-dialog__caption-label"
              >
                Caption
              </label>
              <TokenEstimate text={caption} className="issue-resolver-dialog__caption-tokens" />
            </div>
            <CaptionEditor
              // Fresh editor per item: CodeMirror maps selection through a document swap.
              key={item.path}
              id="issue-resolver-caption"
              completions={captionCompletions}
              value={caption}
              placeholder={placeholder}
              highlightTerms={flaggedPhrases}
              variant={captionDisplay.variant}
              saveState={saveError !== null ? "error" : "idle"}
              aria-label={`Caption for ${item.name}`}
              aria-invalid={saveError !== null}
              title={saveError ?? undefined}
              editable={!saving && !captionLocked}
              onChange={handleCaptionChange}
            />
          </div>
        </div>
      </div>

      <footer className="issue-resolver-dialog__footer">
        <DialogButton
          label="Back"
          variant="secondary"
          disabled={saving || index === 0}
          onClick={handlePrevious}
        />
        <DialogButton
          label="Skip"
          variant="secondary"
          disabled={saving || index === queue.length - 1}
          onClick={handleNext}
        />
        <DialogButton
          label={saving ? "Resolving..." : "Resolve"}
          variant="primary"
          busy={saving}
          onClick={() => {
            void handleResolve();
          }}
        />
      </footer>
      {comfyWorkflowOpen && (
        <ComfyWorkflowDialog
          mediaPath={item.path}
          mediaName={item.name}
          onClose={() => setComfyWorkflowOpen(false)}
        />
      )}
      {discard.promptProps && <DiscardChangesDialog {...discard.promptProps} />}
    </DialogShell>
  );
}
