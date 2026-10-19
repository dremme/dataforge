import { DiscardChangesDialog } from "@/shared/ui/DiscardChangesDialog";
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { dismissDuplicateGroup, resolveDuplicateGroup } from "@/features/gallery/api/duplicates";
import {
  KEEPER_REASON_LABEL,
  chooseKeeper,
  type KeeperReason,
  duplicateGridColumns,
} from "@/features/gallery/lib/duplicates";
import { isVideo } from "@/features/gallery/lib/itemKind";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import { formatApiError } from "@/shared/api/http";
import {
  formatCount,
  formatFileSize,
  formatMegapixels,
  formatModifiedAt,
} from "@/shared/lib/format";
import { classNames } from "@/shared/lib/classNames";
import { iconCheck, iconTrash2, iconTriangleAlert, iconX } from "@/shared/icons";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { DialogButton } from "@/shared/ui/Dialog";
import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
import { Icon } from "@/shared/ui/Icon";
import { DialogShell } from "@/shared/ui/DialogShell";
import type { DuplicateGroup, GalleryItem } from "@/shared/types";
import { useChanged } from "@/shared/hooks/useChanged";

type PendingAction = "resolve" | "dismiss" | null;

interface DuplicateResolverDialogProps {
  groups: DuplicateGroup[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  deletesToTrash: boolean;
  /** After each settled group, with the files it deleted; none when it was dismissed. */
  onResolved: (deletedPaths: string[]) => void;
}

export function DuplicateResolverDialog({
  groups,
  index,
  onClose,
  onIndexChange,
  deletesToTrash,
  onResolved,
}: DuplicateResolverDialogProps) {
  // Frozen at mount: resolving a group removes files and would reshuffle it under the index.
  const [queue] = useState(() => groups);
  const group = queue[index];

  const [keepPath, setKeepPath] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [settledGroups, setSettledGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const busy = pending !== null;

  const suggestion = useMemo(() => (group ? chooseKeeper(group.members) : null), [group]);

  if (useChanged(group?.group)) {
    setKeepPath(null);
    setError(null);
    setPending(null);
    setConfirmOpen(false);
  }

  const selectedPath = keepPath ?? suggestion?.path ?? null;
  const alreadySettled = group ? settledGroups.has(group.group) : false;
  const discardChanges = useDiscardChanges({
    unsavedChanges: !alreadySettled && keepPath !== null && keepPath !== suggestion?.path,
    busy,
    suspended: confirmOpen,
    onNavigationDiscard: onClose,
  });
  const { request: requestDiscard } = discardChanges;

  const discard = useMemo(
    () =>
      group === undefined || selectedPath === null
        ? []
        : group.members.filter((member) => member.path !== selectedPath),
    [group, selectedPath],
  );

  const closeDialog = useCallback(() => {
    void requestDiscard(onClose);
  }, [requestDiscard, onClose]);

  const goTo = useCallback(
    (next: number) => {
      if (next >= 0 && next < queue.length && next !== index)
        void requestDiscard(() => onIndexChange(next));
    },
    [requestDiscard, index, onIndexChange, queue.length],
  );

  const settle = useCallback(
    (groupId: string, deletedPaths: string[]) => {
      setSettledGroups((current) => new Set(current).add(groupId));
      onResolved(deletedPaths);

      if (index < queue.length - 1) {
        onIndexChange(index + 1);
      } else {
        onClose();
      }
    },
    [index, onClose, onIndexChange, onResolved, queue.length],
  );

  const handleResolve = useCallback(async () => {
    if (!group || selectedPath === null || busy || discard.length === 0) return;

    setConfirmOpen(false);
    setPending("resolve");
    setError(null);

    try {
      const result = await resolveDuplicateGroup(
        selectedPath,
        discard.map((member) => member.path),
      );

      if (result.failed.length > 0) {
        setError(`Could not delete ${result.failed.join(", ")}.`);
        return;
      }

      settle(
        group.group,
        discard.map((member) => member.path),
      );
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setPending(null);
    }
  }, [busy, discard, group, selectedPath, settle]);

  const handleDismiss = useCallback(async () => {
    if (!group || busy) return;

    setPending("dismiss");
    setError(null);

    try {
      const result = await dismissDuplicateGroup(group.members.map((member) => member.path));

      if (result.failed.length > 0) {
        setError(`Could not clear the finding for ${result.failed.join(", ")}.`);
        return;
      }

      settle(group.group, []);
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setPending(null);
    }
  }, [busy, group, settle]);

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
      <DialogShell
        block="duplicate-resolver-dialog"
        label={`Resolve duplicate group ${index + 1} of ${queue.length}`}
        onClose={closeDialog}
        busy={busy}
        suspended={confirmOpen || discardChanges.confirming}
        scrollLock="duplicate-resolver-dialog-open"
      >
        <header className="duplicate-resolver-dialog__header">
          <div className="duplicate-resolver-dialog__header-text">
            <h2 className="duplicate-resolver-dialog__title">Resolve duplicates</h2>
            <span className="duplicate-resolver-dialog__counter">
              Group {index + 1} / {queue.length}
            </span>
          </div>
          <button
            type="button"
            className="duplicate-resolver-dialog__close"
            onClick={closeDialog}
            disabled={busy}
            aria-label="Close"
          >
            <Icon icon={iconX} />
          </button>
        </header>

        <div className="duplicate-resolver-dialog__body" data-scroll-lock-allow>
          <div
            className="duplicate-resolver-dialog__grid"
            style={
              { "--duplicate-columns": duplicateGridColumns(group.members.length) } as CSSProperties
            }
            role="radiogroup"
            aria-label="Which file to keep"
          >
            {group.members.map((member) => (
              <MemberCard
                key={member.path}
                member={member}
                selected={member.path === selectedPath}
                suggestedReason={suggestion?.path === member.path ? suggestion.reason : null}
                disabled={busy || alreadySettled}
                onSelect={() => setKeepPath(member.path)}
              />
            ))}
          </div>

          {error && (
            <p className="duplicate-resolver-dialog__error" role="alert">
              <Icon icon={iconTriangleAlert} className="duplicate-resolver-dialog__error-icon" />
              {error}
            </p>
          )}
        </div>

        <footer className="duplicate-resolver-dialog__footer">
          <DialogButton
            label="Back"
            variant="secondary"
            disabled={busy || index === 0}
            onClick={() => goTo(index - 1)}
          />
          <DialogButton
            label="Skip"
            variant="secondary"
            disabled={busy || index === queue.length - 1}
            onClick={() => goTo(index + 1)}
          />
          <DialogButton
            label={pending === "dismiss" ? "Clearing..." : "Not duplicates"}
            variant="warning"
            busy={pending === "dismiss"}
            disabled={busy || alreadySettled}
            onClick={() => {
              void handleDismiss();
            }}
          />
          <DialogButton
            label={pending === "resolve" ? "Deleting..." : "Resolve"}
            variant="primary"
            busy={pending === "resolve"}
            disabled={busy || alreadySettled || discard.length === 0}
            onClick={requestResolve}
          />
        </footer>
      </DialogShell>

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
          busy={busy}
          onConfirm={() => {
            void handleResolve();
          }}
          onCancel={() => {
            if (!busy) setConfirmOpen(false);
          }}
        />
      )}
      {discardChanges.promptProps && <DiscardChangesDialog {...discardChanges.promptProps} />}
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
        "duplicate-resolver-dialog__card",
        selected && "duplicate-resolver-dialog__card--keep",
      )}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="duplicate-resolver-dialog__card-stage">
        {isVideo(member) ? (
          <video
            className="duplicate-resolver-dialog__card-media"
            src={galleryItemMediaUrl(member)}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            className="duplicate-resolver-dialog__card-media"
            src={galleryItemMediaUrl(member)}
            alt={member.name}
            loading="lazy"
          />
        )}

        <span
          className={classNames(
            "duplicate-resolver-dialog__badge",
            selected
              ? "duplicate-resolver-dialog__badge--keep"
              : "duplicate-resolver-dialog__badge--discard",
          )}
        >
          <Icon
            icon={selected ? iconCheck : iconTrash2}
            className="duplicate-resolver-dialog__badge-icon"
          />
          <span className="duplicate-resolver-dialog__badge-label">
            {selected ? "Keep" : "Delete"}
          </span>
        </span>
        {/* On the media, so a suggested card's picture stays as tall as the rest of its row. */}
        {suggestedReason && (
          <span className="duplicate-resolver-dialog__suggestion">
            {KEEPER_REASON_LABEL[suggestedReason]}
          </span>
        )}
      </span>

      <span className="duplicate-resolver-dialog__card-name" title={member.name}>
        {member.name}
      </span>

      <span className="duplicate-resolver-dialog__meta">
        {member.width && member.height ? (
          <>
            <span className="duplicate-resolver-dialog__meta-value">
              {member.width} × {member.height}
            </span>
            <span className="duplicate-resolver-dialog__meta-value">
              {formatMegapixels(member.width, member.height)}
            </span>
          </>
        ) : (
          <span className="duplicate-resolver-dialog__meta-value">Unknown size</span>
        )}
        {member.size != null && (
          <span className="duplicate-resolver-dialog__meta-value">
            {formatFileSize(member.size)}
          </span>
        )}
        <span className="duplicate-resolver-dialog__meta-value">
          {captionLength > 0 ? `${formatCount(captionLength)} char caption` : "No caption"}
        </span>
        {modified && <span className="duplicate-resolver-dialog__meta-value">{modified}</span>}
      </span>
    </button>
  );
}
