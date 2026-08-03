import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCaption, saveCaption, saveCaptionJson } from "@/features/gallery/api/captions";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import { deferNonCriticalWork } from "@/shared/lib/defer";
import { useDebouncedSave } from "@/shared/hooks/useDebouncedSave";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";

function itemCaptionRevision(item: {
  description: string | null;
  caption_status: GalleryItem["caption_status"];
  has_description: boolean;
  caption_file_type: GalleryItem["caption_file_type"];
}): string {
  return JSON.stringify({
    description: item.description,
    caption_status: item.caption_status,
    has_description: item.has_description,
    caption_file_type: item.caption_file_type,
  });
}

function revisionFromSaveResult(result: CaptionSaveResponse): string {
  return itemCaptionRevision({
    description: result.description,
    caption_status: result.caption_status,
    has_description: result.has_description,
    caption_file_type: result.caption_file_type,
  });
}

type CaptionSavePayload = {
  path: string;
  text: string;
};

interface UseGalleryItemCaptionOptions {
  item: GalleryItem | undefined;
  onCaptionSaved: (path: string, update: CaptionSaveResponse) => void;
  /** When false, caption edits stay local until the caller saves explicitly. Default true. */
  autoSave?: boolean;
}

export function useGalleryItemCaption({
  item,
  onCaptionSaved,
  autoSave = true,
}: UseGalleryItemCaptionOptions) {
  const [caption, setCaption] = useState("");
  const [captionContent, setCaptionContent] = useState<string | null>(null);
  const [jsonSaveState, setJsonSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [jsonSaveError, setJsonSaveError] = useState<string | null>(null);
  const { next, isCurrent } = useStaleRequest();
  const captionRef = useRef(caption);
  const captionRevisionRef = useRef<string | null>(null);
  // Every caption state this hook has already shown for the open item. The folder
  // poller reloads browse ~1.5s after a save, and that reload can be answered from
  // data older than the save, so it echoes a revision we have already moved past.
  const seenRevisionsRef = useRef(new Set<string>());

  captionRef.current = caption;

  const markRevision = useCallback((revision: string) => {
    captionRevisionRef.current = revision;
    seenRevisionsRef.current.add(revision);
  }, []);

  const itemPath = item?.path;
  const itemRevision = item ? itemCaptionRevision(item) : null;
  const hasJsonCaption = item?.caption_file_type === "json";

  const persistCaption = useCallback(
    async (payload: CaptionSavePayload) => {
      const result = await saveCaption(payload.path, payload.text);

      setCaption((current) => {
        // Characters typed while the request was open are not in the response.
        if (current.trim() !== payload.text) return current;
        // Keep the editor buffer when the server only echoes the same trimmed text.
        if (current === result.description || current.trim() === (result.description ?? "")) {
          return current;
        }
        return result.description ?? "";
      });
      if (result.caption_content != null) {
        setCaptionContent(result.caption_content);
      }
      // Match the browse revision produced by onCaptionSaved so background sync
      // does not wipe caption_content after a save.
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
    (source: GalleryItem, options: { resetCaptionContent?: boolean } = {}) => {
      const cachedCaption = source.description ?? "";

      setCaption(cachedCaption);
      // Browse items do not carry caption_content; only clear it on full item reload.
      if (options.resetCaptionContent) {
        setCaptionContent(null);
      }
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
    applyCaptionFromItem(item, { resetCaptionContent: true });

    const requestId = next();

    const cancelDeferredCaptionLoad = deferNonCriticalWork(() => {
      void fetchCaption(itemPath)
        .then((fresh) => {
          if (!isCurrent(requestId)) return;

          // Typing can start before this lands; the editor buffer wins over the
          // file on disk, and the pending save carries it to the server.
          if (hasUnsavedChanges({ path: itemPath, text: captionRef.current })) {
            // Independent of the text buffer, and the .json editor needs it.
            setCaptionContent(fresh.caption_content ?? null);
            return;
          }

          const caption = fresh.description ?? "";
          setCaption(caption);
          setBaseline({ path: itemPath, text: caption });
          setCaptionContent(fresh.caption_content ?? null);
          markRevision(revisionFromSaveResult(fresh));
          onCaptionSaved(itemPath, fresh);
        })
        .catch(() => {
          // Keep cached folder data when the refresh request fails.
        });
    });

    return cancelDeferredCaptionLoad;
    // Depend on itemPath only — not `item`. fetchCaption calls onCaptionSaved which
    // updates the parent browse state and replaces the item object, which would
    // retrigger this effect endlessly if `item` were listed here.
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

    // A folder reload answered from data older than our last write echoes a state
    // this item already had. Applying it would undo newer text, so it is dropped
    // without recording the revision — a later reload still reconciles real edits.
    if (hadPreviousRevision && seenRevisionsRef.current.has(itemRevision)) return;

    markRevision(itemRevision);

    if (!hadPreviousRevision) return;

    if (hasUnsavedChanges({ path: itemPath, text: captionRef.current })) {
      return;
    }

    const incomingCaption = item.description ?? "";
    const current = captionRef.current;
    if (current === incomingCaption || current.trim() === incomingCaption) {
      // Browse echoed our own save (possibly after server-side whitespace normalization).
      // Keep the editor's exact buffer (e.g. trailing spaces while typing) and baseline.
      return;
    }

    // Keep caption_content from the last fetch/save — browse items never include it.
    applyCaptionFromItem(item, { resetCaptionContent: false });
  }, [applyCaptionFromItem, hasUnsavedChanges, item, itemPath, itemRevision, markRevision]);

  const handleCaptionChange = useCallback(
    (value: string) => {
      if (!item) return;
      setCaption(value);
      if (!autoSave) return;
      // Send a normalized (trimmed) version for save so that the persisted
      // value and server echoes match the backend normalization. The local
      // `caption` buffer retains the user's exact input (including temporary
      // trailing whitespace) for a smooth typing experience.
      scheduleSave({ path: item.path, text: value.trim() });
    },
    [autoSave, item, scheduleSave],
  );

  const handleJsonContentSave = useCallback(
    async (jsonContent: string) => {
      if (!item) return false;

      flushPendingSave();
      invalidateInFlight();
      setJsonSaveState("saving");
      setJsonSaveError(null);

      try {
        const result = await saveCaptionJson(item.path, jsonContent);
        const nextCaption = result.description ?? "";

        setCaption(nextCaption);
        setCaptionContent(result.caption_content ?? null);
        setBaseline({ path: item.path, text: nextCaption });
        markRevision(revisionFromSaveResult(result));
        onCaptionSaved(item.path, result);
        setJsonSaveState("idle");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save JSON caption";
        setJsonSaveState("error");
        setJsonSaveError(message);
        return false;
      }
    },
    [flushPendingSave, invalidateInFlight, item, markRevision, onCaptionSaved, setBaseline],
  );

  const resetJsonSaveState = useCallback(() => {
    setJsonSaveState("idle");
    setJsonSaveError(null);
  }, []);

  return {
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
  };
}
