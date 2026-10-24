import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCaption, saveCaption } from "@/features/gallery/api/captions";
import type { CaptionReadError, CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { isApiErrorCode } from "@/shared/api/http";
import { deferNonCriticalWork } from "@/shared/lib/defer";
import { useDebouncedSave } from "@/shared/hooks/useDebouncedSave";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";

type CaptionFields = Pick<
  CaptionSaveResponse,
  "description" | "caption_status" | "has_description" | "caption_revision"
>;

/** Identifies what the listing shows, so a changed revision with unchanged text still syncs. */
function itemCaptionRevision(item: CaptionFields): string {
  return JSON.stringify({
    description: item.description,
    caption_status: item.caption_status,
    has_description: item.has_description,
    caption_revision: item.caption_revision ?? null,
  });
}

type CaptionSavePayload = {
  path: string;
  text: string;
};

interface UseGalleryItemCaptionOptions {
  item: GalleryItem | undefined;
  onCaptionSaved: (path: string, update: CaptionSaveResponse) => void;
  autoSave?: boolean;
}

const isCaptionConflict = (error: unknown) => isApiErrorCode(error, "caption_conflict");

export function useGalleryItemCaption({
  item,
  onCaptionSaved,
  autoSave = true,
}: UseGalleryItemCaptionOptions) {
  const [caption, setCaption] = useState("");
  const [readError, setReadError] = useState<CaptionReadError | null>(null);
  // An unreadable caption stays locked until the user chooses to write a new one over it.
  const [replacingUnreadable, setReplacingUnreadable] = useState(false);
  const { next, isCurrent } = useStaleRequest();
  const captionRef = useRef(caption);
  const captionRevisionRef = useRef<string | null>(null);
  // Per path: what each save names as its base. A save queued for the previous item can still
  // run after the next one opens, so one shared value would hand it the wrong base.
  const serverRevisionsRef = useRef(new Map<string, string | null>());
  // Revisions shown since this item opened.
  const shownRevisionsRef = useRef(new Set<string>());
  // Armed by a save: a poller reload can answer from data older than it, so a revision shown
  // before the save is a stale echo until the server reports the save or anything newer. Not
  // a plain seen-set: a restore back to earlier text is a genuine change and must sync.
  const staleRevisionsRef = useRef<Set<string> | null>(null);

  captionRef.current = caption;

  const markRevision = useCallback((revision: string) => {
    captionRevisionRef.current = revision;
    shownRevisionsRef.current.add(revision);
  }, []);

  const armStaleRevisions = useCallback((saved: string) => {
    const stale = new Set(shownRevisionsRef.current);
    stale.delete(saved);
    staleRevisionsRef.current = stale;
  }, []);

  const rememberServerRevision = useCallback((path: string, fields: CaptionFields) => {
    serverRevisionsRef.current.set(path, fields.caption_revision ?? null);
  }, []);

  const itemPath = item?.path;
  const itemPathRef = useRef(itemPath);
  itemPathRef.current = itemPath;
  const itemRevision = item ? itemCaptionRevision(item) : null;

  const persistCaption = useCallback(
    async (payload: CaptionSavePayload) => {
      const result = await saveCaption(payload.path, payload.text, {
        baseRevision: serverRevisionsRef.current.get(payload.path) ?? null,
      });
      rememberServerRevision(payload.path, result);

      if (itemPathRef.current !== payload.path) {
        onCaptionSaved(payload.path, result);
        return;
      }

      setReadError(null);
      setCaption((current) => {
        if (current.trim() !== payload.text) return current;
        if (current === result.description || current.trim() === (result.description ?? "")) {
          return current;
        }
        return result.description ?? "";
      });
      // Match the folder revision from onCaptionSaved so background sync does not wipe a save.
      const saved = itemCaptionRevision(result);
      armStaleRevisions(saved);
      markRevision(saved);
      onCaptionSaved(payload.path, result);
    },
    [armStaleRevisions, markRevision, onCaptionSaved, rememberServerRevision],
  );

  const {
    saveState,
    saveError,
    scheduleSave,
    flushPendingSave,
    retrySave,
    resolveConflict,
    setBaseline,
    invalidateInFlight,
    hasUnsavedChanges,
    discardPendingSave,
    saving,
  } = useDebouncedSave<CaptionSavePayload>({
    errorMessage: "Failed to save caption",
    save: persistCaption,
    isUnchanged: (pending, lastSaved) => pending.text === lastSaved.text,
    isConflict: isCaptionConflict,
  });

  /** Shows the server's caption as the clean state; `fields` is a listing item or a fresh read. */
  const adoptServerCaption = useCallback(
    (path: string, fields: CaptionFields & Pick<CaptionSaveResponse, "caption_read_error">) => {
      const text = fields.description ?? "";
      setCaption(text);
      setBaseline({ path, text });
      setReadError(fields.caption_read_error ?? null);
      rememberServerRevision(path, fields);
      markRevision(itemCaptionRevision(fields));
    },
    [markRevision, rememberServerRevision, setBaseline],
  );

  useEffect(() => {
    if (!itemPath || !item) return;

    if (autoSave) {
      flushPendingSave();
    }
    invalidateInFlight();
    shownRevisionsRef.current.clear();
    staleRevisionsRef.current = null;
    setReplacingUnreadable(false);
    adoptServerCaption(itemPath, item);

    const requestId = next();

    const cancelDeferredCaptionLoad = deferNonCriticalWork(() => {
      void fetchCaption(itemPath)
        .then((fresh) => {
          if (!isCurrent(requestId)) return;

          if (hasUnsavedChanges({ path: itemPath, text: captionRef.current })) {
            return;
          }

          adoptServerCaption(itemPath, fresh);
          onCaptionSaved(itemPath, fresh);
        })
        .catch(() => {});
    });

    return cancelDeferredCaptionLoad;
    // itemPath only, not item: onCaptionSaved replaces the item object and would retrigger.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- isCurrent/next/item omitted on purpose
  }, [
    adoptServerCaption,
    autoSave,
    flushPendingSave,
    hasUnsavedChanges,
    invalidateInFlight,
    itemPath,
    onCaptionSaved,
  ]);

  useEffect(() => {
    if (!itemPath || !item || itemRevision === null) return;

    const stale = staleRevisionsRef.current;
    if (stale) {
      // Stale poller echo from before the last save; applying it would undo the save.
      if (stale.has(itemRevision)) return;
      // The save itself, or something newer: the server has caught up.
      staleRevisionsRef.current = null;
    }

    if (captionRevisionRef.current === itemRevision) return;

    const hadPreviousRevision = captionRevisionRef.current !== null;

    markRevision(itemRevision);

    if (!hadPreviousRevision) return;

    if (hasUnsavedChanges({ path: itemPath, text: captionRef.current })) {
      return;
    }

    const incomingCaption = item.description ?? "";
    const current = captionRef.current;
    if (current === incomingCaption || current.trim() === incomingCaption) {
      // Listing echoed our own save (possibly whitespace-normalized); keep the editor buffer,
      // but take the revision: nothing is unsaved, so the next save starts from the file as is.
      rememberServerRevision(itemPath, item);
      setReadError(item.caption_read_error ?? null);
      return;
    }

    adoptServerCaption(itemPath, item);
  }, [
    adoptServerCaption,
    hasUnsavedChanges,
    item,
    itemPath,
    itemRevision,
    markRevision,
    rememberServerRevision,
  ]);

  const captionLocked = readError !== null && !replacingUnreadable;

  const handleCaptionChange = useCallback(
    (value: string) => {
      if (!item || captionLocked) return;
      setCaption(value);
      if (!autoSave) return;
      // Persist trimmed so server echoes match backend normalization; the local buffer keeps exact input.
      scheduleSave({ path: item.path, text: value.trim() });
    },
    [autoSave, captionLocked, item, scheduleSave],
  );

  /** Throws away the draft and shows the caption as it is on disk now. */
  const reloadCaption = useCallback(async (): Promise<boolean> => {
    if (!item) return false;
    const path = item.path;
    let fresh: CaptionSaveResponse;
    try {
      fresh = await fetchCaption(path);
    } catch {
      return false;
    }
    if (itemPathRef.current !== path) return false;

    discardPendingSave();
    setReplacingUnreadable(false);
    adoptServerCaption(path, fresh);
    onCaptionSaved(path, fresh);
    return true;
  }, [adoptServerCaption, discardPendingSave, item, onCaptionSaved]);

  /** Saves the draft over whatever the caption became meanwhile. */
  const overwriteCaption = useCallback(async (): Promise<boolean> => {
    if (!item) return false;
    const path = item.path;
    let fresh: CaptionSaveResponse;
    try {
      fresh = await fetchCaption(path);
    } catch {
      return false;
    }
    if (itemPathRef.current !== path) return false;

    rememberServerRevision(path, fresh);
    resolveConflict();
    return flushPendingSave(true);
  }, [flushPendingSave, item, rememberServerRevision, resolveConflict]);

  return {
    caption,
    saveState,
    saveError,
    conflict: saveState === "conflict",
    hasUnsavedChanges: item ? hasUnsavedChanges({ path: item.path, text: caption.trim() }) : false,
    handleCaptionChange,
    retrySave,
    saving,
    flushPendingSave,
    reloadCaption,
    overwriteCaption,
    /** Why the caption file could not be shown; `null` once it can be, or is being replaced. */
    readError: captionLocked ? readError : null,
    captionLocked,
    replaceUnreadableCaption: () => setReplacingUnreadable(true),
    /** What a save made outside this hook must name as its base. */
    baseRevisionFor: (path: string) => serverRevisionsRef.current.get(path) ?? null,
    discardCaptionChanges: () => {
      discardPendingSave();
      if (item) adoptServerCaption(item.path, item);
    },
  };
}
