import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCaption, saveCaption } from "@/features/gallery/api/captions";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { deferNonCriticalWork } from "@/shared/lib/defer";
import { useDebouncedSave } from "@/shared/hooks/useDebouncedSave";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";

function itemCaptionRevision(item: {
  description: string | null;
  caption_status: GalleryItem["caption_status"];
  has_description: boolean;
}): string {
  return JSON.stringify({
    description: item.description,
    caption_status: item.caption_status,
    has_description: item.has_description,
  });
}

function revisionFromSaveResult(result: CaptionSaveResponse): string {
  return itemCaptionRevision({
    description: result.description,
    caption_status: result.caption_status,
    has_description: result.has_description,
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

export function useGalleryItemCaption({
  item,
  onCaptionSaved,
  autoSave = true,
}: UseGalleryItemCaptionOptions) {
  const [caption, setCaption] = useState("");
  const { next, isCurrent } = useStaleRequest();
  const captionRef = useRef(caption);
  const captionRevisionRef = useRef<string | null>(null);
  // Revisions already shown here. A poller reload can answer from data older than the save.
  const seenRevisionsRef = useRef(new Set<string>());

  captionRef.current = caption;

  const markRevision = useCallback((revision: string) => {
    captionRevisionRef.current = revision;
    seenRevisionsRef.current.add(revision);
  }, []);

  const itemPath = item?.path;
  const itemRevision = item ? itemCaptionRevision(item) : null;

  const persistCaption = useCallback(
    async (payload: CaptionSavePayload) => {
      const result = await saveCaption(payload.path, payload.text);

      setCaption((current) => {
        if (current.trim() !== payload.text) return current;
        if (current === result.description || current.trim() === (result.description ?? "")) {
          return current;
        }
        return result.description ?? "";
      });
      // Match the folder revision from onCaptionSaved so background sync does not wipe a save.
      markRevision(revisionFromSaveResult(result));
      onCaptionSaved(payload.path, result);
    },
    [markRevision, onCaptionSaved],
  );

  const {
    saveState,
    saveError,
    scheduleSave,
    flushPendingSave,
    setBaseline,
    invalidateInFlight,
    hasUnsavedChanges,
  } = useDebouncedSave<CaptionSavePayload>({
    errorMessage: "Failed to save caption",
    save: persistCaption,
    isUnchanged: (pending, lastSaved) => pending.text === lastSaved.text,
  });

  const applyCaptionFromItem = useCallback(
    (source: GalleryItem) => {
      const cachedCaption = source.description ?? "";

      setCaption(cachedCaption);
      setBaseline({ path: source.path, text: cachedCaption });
      markRevision(itemCaptionRevision(source));
    },
    [markRevision, setBaseline],
  );

  useEffect(() => {
    if (!itemPath || !item) return;

    if (autoSave) {
      flushPendingSave();
    }
    invalidateInFlight();
    seenRevisionsRef.current.clear();
    applyCaptionFromItem(item);

    const requestId = next();

    const cancelDeferredCaptionLoad = deferNonCriticalWork(() => {
      void fetchCaption(itemPath)
        .then((fresh) => {
          if (!isCurrent(requestId)) return;

          if (hasUnsavedChanges({ path: itemPath, text: captionRef.current })) {
            return;
          }

          const caption = fresh.description ?? "";
          setCaption(caption);
          setBaseline({ path: itemPath, text: caption });
          markRevision(revisionFromSaveResult(fresh));
          onCaptionSaved(itemPath, fresh);
        })
        .catch(() => {});
    });

    return cancelDeferredCaptionLoad;
    // itemPath only, not item: onCaptionSaved replaces the item object and would retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isCurrent/next/item omitted on purpose
  }, [
    applyCaptionFromItem,
    autoSave,
    flushPendingSave,
    hasUnsavedChanges,
    invalidateInFlight,
    itemPath,
    onCaptionSaved,
    setBaseline,
  ]);

  useEffect(() => {
    if (!itemPath || !item || itemRevision === null) return;

    if (captionRevisionRef.current === itemRevision) return;

    const hadPreviousRevision = captionRevisionRef.current !== null;

    // Stale poller echo of a revision already shown; applying it would undo newer text.
    if (hadPreviousRevision && seenRevisionsRef.current.has(itemRevision)) return;

    markRevision(itemRevision);

    if (!hadPreviousRevision) return;

    if (hasUnsavedChanges({ path: itemPath, text: captionRef.current })) {
      return;
    }

    const incomingCaption = item.description ?? "";
    const current = captionRef.current;
    if (current === incomingCaption || current.trim() === incomingCaption) {
      // Listing echoed our own save (possibly whitespace-normalized); keep the editor buffer.
      return;
    }

    applyCaptionFromItem(item);
  }, [applyCaptionFromItem, hasUnsavedChanges, item, itemPath, itemRevision, markRevision]);

  const handleCaptionChange = useCallback(
    (value: string) => {
      if (!item) return;
      setCaption(value);
      if (!autoSave) return;
      // Persist trimmed so server echoes match backend normalization; the local buffer keeps exact input.
      scheduleSave({ path: item.path, text: value.trim() });
    },
    [autoSave, item, scheduleSave],
  );

  return {
    caption,
    saveState,
    saveError,
    handleCaptionChange,
    flushPendingSave,
  };
}
