import { useCallback, useEffect, useMemo, useState } from "react";
import { saveCaption } from "@/features/gallery/api/captions";
import { openMediaInViewer } from "@/features/gallery/api/media";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import { formatApiError } from "@/shared/api/http";
import { getGalleryItemCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { flaggedCaptionPhrases } from "@/features/gallery/lib/issues";
import { useGalleryItemCaption } from "@/features/gallery/hooks/useGalleryItemCaption";
import { useMediaResolution } from "@/features/gallery/hooks/useMediaResolution";
import { isMotion, isVideo, mediaLabelFor } from "@/features/gallery/lib/itemKind";
import {
  collectAdjacentModalMediaTargets,
  schedulePrefetchModalMedia,
} from "@/features/gallery/lib/modalMediaPrefetch";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { formatMegapixels } from "@/shared/lib/format";
import { classNames } from "@/shared/lib/classNames";
import {
  iconArrowUpRight,
  iconCircleCheck,
  iconLoader2,
  iconTriangleAlert,
  iconX,
} from "@/shared/icons";
import { CaptionEditor } from "@/shared/ui/CaptionEditor";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ZoomableImage } from "./ZoomableImage";

function issueCardLabel(fixCount: number, resolved: boolean): string {
  if (fixCount === 0) return resolved ? "Resolved" : "Issue";
  return resolved ? "Applied changes" : "Suggested changes";
}

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<boolean>(false);
  // Queue is frozen at mount, so a resolved entry keeps its fixes unless this records them.
  const [resolvedPaths, setResolvedPaths] = useState<ReadonlySet<string>>(() => new Set());
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

  useEffect(() => {
    return schedulePrefetchModalMedia(collectAdjacentModalMediaTargets(queue, index));
  }, [index, queue]);

  // Above the early return: the highlight terms below derive from these through a hook.
  const fixes = useMemo(
    () => (item?.issue_fixes ?? []).map((fix) => fix.trim()).filter(Boolean),
    [item?.issue_fixes],
  );
  const flaggedPhrases = useMemo(() => flaggedCaptionPhrases(fixes), [fixes]);

  const closeModal = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  const handleNext = useCallback(() => {
    if (saving) return;
    if (index < queue.length - 1) onIndexChange(index + 1);
  }, [index, onIndexChange, queue.length, saving]);

  const handlePrevious = useCallback(() => {
    if (saving) return;
    if (index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange, saving]);

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
      const result = await saveCaption(item.path, caption.trim(), { resolveIssue: true });
      onCaptionSaved(item.path, result);
      setResolvedPaths((current) => new Set(current).add(item.path));

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
  const mediaLabel = mediaLabelFor(item);
  const captionDisplay = getGalleryItemCaptionDisplay(item, mediaLabel);
  const resolution = getResolution(item);
  const placeholder =
    captionDisplay.variant === "success" ? "Add a caption..." : captionDisplay.message;
  const alreadyResolved = resolvedPaths.has(item.path);

  return (
    <ModalShell
      block="issue-resolver-modal"
      label={`Resolve caption issue for ${item.name}`}
      onClose={closeModal}
      busy={saving}
      scrollLock="issue-resolver-modal-open"
    >
      <header className="issue-resolver-modal__header">
        <div className="issue-resolver-modal__header-text">
          <h2 className="issue-resolver-modal__title">Resolve caption issues</h2>
          <span className="issue-resolver-modal__counter">
            {index + 1} / {queue.length}
          </span>
        </div>
        <div className="issue-resolver-modal__header-actions">
          {!isMotion(item) && (
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
              className="issue-resolver-modal__media-wrap"
              imgClassName="issue-resolver-modal__img"
              src={galleryItemMediaUrl(item)}
              alt={item.name}
              onLoad={(event) => {
                const img = event.currentTarget;
                recordResolution(img.naturalWidth, img.naturalHeight, item.path);
              }}
            />
          )}
        </div>

        <div className="issue-resolver-modal__details" data-scroll-lock-allow>
          <p className="issue-resolver-modal__file-name" title={item.name}>
            {item.name}
          </p>
          <div className="issue-resolver-modal__meta">
            {resolution && (
              <>
                <div className="issue-resolver-modal__meta-value">
                  {formatMegapixels(resolution.width, resolution.height)}
                </div>
                <span className="issue-resolver-modal__meta-divider" aria-hidden="true" />
                <div className="issue-resolver-modal__meta-value">
                  {resolution.width} × {resolution.height}
                </div>
                <span className="issue-resolver-modal__meta-divider" aria-hidden="true" />
              </>
            )}
            <div className="issue-resolver-modal__meta-value">
              {caption.length.toLocaleString()} characters
            </div>
          </div>

          <div
            className={classNames(
              "issue-resolver-modal__issue-card",
              alreadyResolved && "issue-resolver-modal__issue-card--resolved",
            )}
          >
            <div className="issue-resolver-modal__issue-row">
              <Icon
                icon={alreadyResolved ? iconCircleCheck : iconTriangleAlert}
                className="issue-resolver-modal__issue-icon"
              />
              <div className="issue-resolver-modal__issue-content">
                <span className="issue-resolver-modal__issue-label">
                  {issueCardLabel(fixes.length, alreadyResolved)}
                </span>
                {fixes.length > 0 ? (
                  <ol className="issue-resolver-modal__issue-list">
                    {fixes.map((fix) => (
                      <li key={fix} className="issue-resolver-modal__issue-text">
                        {fix}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="issue-resolver-modal__issue-text">
                    {alreadyResolved ? "The caption was saved." : "Error in issue file"}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="issue-resolver-modal__caption-editor">
            <label htmlFor="issue-resolver-caption" className="issue-resolver-modal__caption-label">
              Caption
            </label>
            <CaptionEditor
              // Fresh editor per item: CodeMirror maps selection through a document swap.
              key={item.path}
              id="issue-resolver-caption"
              value={caption}
              placeholder={placeholder}
              highlightTerms={flaggedPhrases}
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
    </ModalShell>
  );
}
