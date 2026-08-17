import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveDuplicateGroup } from "@/features/gallery/api/duplicates";
import {
  KEEPER_REASON_LABEL,
  chooseKeeper,
  type KeeperReason,
} from "@/features/gallery/lib/duplicates";
import { isVideo } from "@/features/gallery/lib/itemKind";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import { formatApiError } from "@/shared/api/http";
import { formatFileSize, formatMegapixels, formatModifiedAt } from "@/shared/lib/format";
import { classNames } from "@/shared/lib/classNames";
import { iconCheck, iconTrash2, iconTriangleAlert, iconX } from "@/shared/icons";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import type { DuplicateGroup, GalleryItem } from "@/shared/types";

interface DuplicateResolverModalProps {
  groups: DuplicateGroup[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  /**
   * Whether a discarded file lands somewhere recoverable.
   *
   * Where it does - the Recycle Bin on Windows - deleting is a click, because
   * walking a long queue with a dialog between every group is its own kind of bad
   * and the deletion can be undone. Where it does not, the same click is permanent,
   * so it earns a confirmation naming the files.
   */
  deletesToTrash: boolean;
  /** Fires after files are removed, so the folder listing can catch up. */
  onResolved: () => void;
}

export function DuplicateResolverModal({
  groups,
  index,
  onClose,
  onIndexChange,
  deletesToTrash,
  onResolved,
}: DuplicateResolverModalProps) {
  // Frozen at mount, like the issue resolver's queue: resolving a group removes files,
  // which would otherwise reshuffle the list under the index mid-walk.
  const [queue] = useState(() => groups);
  const group = queue[index];

  const [keepPath, setKeepPath] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedGroups, setResolvedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const suggestion = useMemo(() => (group ? chooseKeeper(group.members) : null), [group]);

  // A new group arrives with its own suggestion, and none of the previous state.
  useEffect(() => {
    setKeepPath(null);
    setError(null);
    setResolving(false);
    setConfirmOpen(false);
  }, [group?.group]);

  const selectedPath = keepPath ?? suggestion?.path ?? null;
  const alreadyResolved = group ? resolvedGroups.has(group.group) : false;

  const discard = useMemo(
    () =>
      group === undefined || selectedPath === null
        ? []
        : group.members.filter((member) => member.path !== selectedPath),
    [group, selectedPath],
  );

  const closeModal = useCallback(() => {
    if (resolving) return;
    onClose();
  }, [onClose, resolving]);

  const goTo = useCallback(
    (next: number) => {
      if (resolving) return;
      if (next >= 0 && next < queue.length) onIndexChange(next);
    },
    [onIndexChange, queue.length, resolving],
  );

  const handleResolve = useCallback(async () => {
    if (!group || selectedPath === null || resolving || discard.length === 0) return;

    setConfirmOpen(false);
    setResolving(true);
    setError(null);

    try {
      const result = await resolveDuplicateGroup(
        selectedPath,
        discard.map((member) => member.path),
      );

      if (result.failed.length > 0) {
        setError(`Could not delete ${result.failed.join(", ")}.`);
        setResolving(false);
        return;
      }

      setResolvedGroups((current) => new Set(current).add(group.group));
      onResolved();

      if (index < queue.length - 1) {
        onIndexChange(index + 1);
      } else {
        onClose();
      }
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setResolving(false);
    }
  }, [
    discard,
    group,
    index,
    onClose,
    onIndexChange,
    onResolved,
    queue.length,
    resolving,
    selectedPath,
  ]);

  // Where a delete is recoverable this is the whole action; where it is not, the
  // dialog stands between the click and the files.
  const requestResolve = useCallback(() => {
    if (deletesToTrash) {
      void handleResolve();
      return;
    }
    setConfirmOpen(true);
  }, [deletesToTrash, handleResolve]);

  if (!group) return null;

  return (
    <>
      <ModalShell
        block="duplicate-resolver-modal"
        label={`Resolve duplicate group ${index + 1} of ${queue.length}`}
        onClose={closeModal}
        busy={resolving}
        suspended={confirmOpen}
        scrollLock="duplicate-resolver-modal-open"
      >
        <header className="duplicate-resolver-modal__header">
          <div className="duplicate-resolver-modal__header-text">
            <h2 className="duplicate-resolver-modal__title">Resolve duplicates</h2>
            <span className="duplicate-resolver-modal__counter">
              Group {index + 1} / {queue.length}
            </span>
          </div>
          <button
            type="button"
            className="duplicate-resolver-modal__close"
            onClick={closeModal}
            disabled={resolving}
            aria-label="Close"
          >
            <Icon icon={iconX} />
          </button>
        </header>

        <div className="duplicate-resolver-modal__body" data-scroll-lock-allow>
          <div
            className={classNames(
              "duplicate-resolver-modal__grid",
              group.members.length === 2 && "duplicate-resolver-modal__grid--pair",
            )}
            role="radiogroup"
            aria-label="Which file to keep"
          >
            {group.members.map((member) => (
              <MemberCard
                key={member.path}
                member={member}
                selected={member.path === selectedPath}
                suggestedReason={suggestion?.path === member.path ? suggestion.reason : null}
                disabled={resolving || alreadyResolved}
                onSelect={() => setKeepPath(member.path)}
              />
            ))}
          </div>

          {error && (
            <p className="duplicate-resolver-modal__error" role="alert">
              <Icon icon={iconTriangleAlert} className="duplicate-resolver-modal__error-icon" />
              {error}
            </p>
          )}
        </div>

        <footer className="duplicate-resolver-modal__footer">
          <DialogButton
            label="Back"
            variant="secondary"
            disabled={resolving || index === 0}
            onClick={() => goTo(index - 1)}
          />
          <DialogButton
            label="Skip"
            variant="secondary"
            disabled={resolving || index === queue.length - 1}
            onClick={() => goTo(index + 1)}
          />
          <DialogButton
            label={resolving ? "Deleting..." : "Resolve"}
            variant="primary"
            busy={resolving}
            disabled={alreadyResolved || discard.length === 0}
            onClick={requestResolve}
          />
        </footer>
      </ModalShell>

      {confirmOpen && (
        <ConfirmDialog
          title={`Delete ${discard.length} ${discard.length === 1 ? "file" : "files"}?`}
          description={`${discard
            .map((member) => member.name)
            .join(
              ", ",
            )} will be deleted permanently. This platform has no Recycle Bin, so it cannot be undone. ${
            group.members.find((member) => member.path === selectedPath)?.name ?? "The kept file"
          } is kept.`}
          confirmLabel="Delete permanently"
          confirmVariant="danger"
          busy={resolving}
          onConfirm={() => {
            void handleResolve();
          }}
          onCancel={() => {
            if (!resolving) setConfirmOpen(false);
          }}
        />
      )}
    </>
  );
}

function MemberCard({
  member,
  selected,
  suggestedReason,
  disabled,
  onSelect,
}: {
  member: GalleryItem;
  selected: boolean;
  suggestedReason: KeeperReason | null;
  disabled: boolean;
  onSelect: () => void;
}) {
  const modified = member.modified_at ? formatModifiedAt(member.modified_at) : null;
  const captionLength = member.description?.length ?? 0;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={classNames(
        "duplicate-resolver-modal__card",
        selected && "duplicate-resolver-modal__card--keep",
      )}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="duplicate-resolver-modal__card-stage">
        {isVideo(member) ? (
          <video
            className="duplicate-resolver-modal__card-media"
            src={galleryItemMediaUrl(member)}
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            className="duplicate-resolver-modal__card-media"
            src={galleryItemMediaUrl(member)}
            alt={member.name}
            loading="lazy"
          />
        )}

        <span
          className={classNames(
            "duplicate-resolver-modal__badge",
            selected
              ? "duplicate-resolver-modal__badge--keep"
              : "duplicate-resolver-modal__badge--discard",
          )}
        >
          <Icon
            icon={selected ? iconCheck : iconTrash2}
            className="duplicate-resolver-modal__badge-icon"
          />
          {selected ? "Keep" : "Delete"}
        </span>
      </span>

      <span className="duplicate-resolver-modal__card-name" title={member.name}>
        {member.name}
      </span>

      {/* The same brief meta row the issue resolver shows, which is what makes the two
          copies comparable at a glance. */}
      <span className="duplicate-resolver-modal__meta">
        {member.width && member.height ? (
          <>
            <span className="duplicate-resolver-modal__meta-value">
              {member.width} × {member.height}
            </span>
            <span className="duplicate-resolver-modal__meta-value">
              {formatMegapixels(member.width, member.height)}
            </span>
          </>
        ) : (
          <span className="duplicate-resolver-modal__meta-value">Unknown size</span>
        )}
        {member.size != null && (
          <span className="duplicate-resolver-modal__meta-value">
            {formatFileSize(member.size)}
          </span>
        )}
        <span className="duplicate-resolver-modal__meta-value">
          {captionLength > 0 ? `${captionLength.toLocaleString()} char caption` : "No caption"}
        </span>
        {modified && <span className="duplicate-resolver-modal__meta-value">{modified}</span>}
      </span>

      {suggestedReason && (
        <span className="duplicate-resolver-modal__suggestion">
          {KEEPER_REASON_LABEL[suggestedReason]}
        </span>
      )}
    </button>
  );
}
