import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCaption, saveCaption, saveCaptionJson } from "../api";
import type { CaptionBBox, CaptionSaveResponse, GalleryItem } from "../types";
import { bboxesEqual } from "../utils/bbox";
import { deferNonCriticalWork } from "../utils/defer";
import { useDebouncedSave } from "./useDebouncedSave";
import { useStaleRequest } from "./useStaleRequest";

function itemCaptionRevision(item: {
  description: string | null;
  bboxes?: CaptionBBox[] | null;
  caption_status: GalleryItem["caption_status"];
  has_description: boolean;
  caption_file_type: GalleryItem["caption_file_type"];
}): string {
  return JSON.stringify({
    description: item.description,
    bboxes: item.bboxes ?? [],
    caption_status: item.caption_status,
    has_description: item.has_description,
    caption_file_type: item.caption_file_type,
  });
}

function revisionFromSaveResult(result: CaptionSaveResponse): string {
  return itemCaptionRevision({
    description: result.description,
    bboxes: result.bboxes,
    caption_status: result.caption_status,
    has_description: result.has_description,
    caption_file_type: result.caption_file_type,
  });
}

function nextSelectedBboxIndex(
  current: number | null,
  bboxCount: number,
  preserveSelection: boolean,
): number | null {
  if (bboxCount === 0) return null;
  if (preserveSelection && current != null && current < bboxCount) {
    return current;
  }
  return bboxCount - 1;
}

type CaptionSavePayload = {
  path: string;
  text: string;
  bboxes?: CaptionBBox[];
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
  const [bboxes, setBboxes] = useState<CaptionBBox[]>([]);
  const [selectedBboxIndex, setSelectedBboxIndex] = useState<number | null>(null);
  const [captionContent, setCaptionContent] = useState<string | null>(null);
  const [jsonSaveState, setJsonSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [jsonSaveError, setJsonSaveError] = useState<string | null>(null);
  const { next, isCurrent } = useStaleRequest();
  const captionRef = useRef(caption);
  const bboxesRef = useRef(bboxes);
  const captionRevisionRef = useRef<string | null>(null);

  captionRef.current = caption;
  bboxesRef.current = bboxes;

  const itemPath = item?.path;
  const itemRevision = item ? itemCaptionRevision(item) : null;
  const hasJsonCaption = item?.caption_file_type === "json";
  const bboxesEditable = hasJsonCaption && bboxes.length > 0;

  const persistCaption = useCallback(
    async (payload: CaptionSavePayload) => {
      const result = await saveCaption(payload.path, payload.text, payload.bboxes);
      const nextBboxes = result.bboxes ?? payload.bboxes ?? bboxesRef.current;

      // Keep the editor buffer when the server only echoes the same trimmed text.
      setCaption((current) =>
        current === result.description || current.trim() === (result.description ?? "")
          ? current
          : (result.description ?? ""),
      );
      setBboxes(nextBboxes);
      setSelectedBboxIndex((current) => nextSelectedBboxIndex(current, nextBboxes.length, true));
      if (result.caption_content != null) {
        setCaptionContent(result.caption_content);
      }
      // Match the browse revision produced by onCaptionSaved so background sync
      // does not wipe caption_content / selection after a bbox save.
      captionRevisionRef.current = itemCaptionRevision({
        description: result.description,
        bboxes: nextBboxes,
        caption_status: result.caption_status,
        has_description: result.has_description,
        caption_file_type: result.caption_file_type,
      });
      onCaptionSaved(payload.path, result);
    },
    [onCaptionSaved],
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
    isUnchanged: (pending, lastSaved) => {
      const captionUnchanged = pending.text === lastSaved.text;
      const bboxesUnchanged =
        !pending.bboxes || bboxesEqual(pending.bboxes, lastSaved.bboxes ?? []);
      return captionUnchanged && bboxesUnchanged;
    },
  });

  const applyCaptionFromItem = useCallback(
    (
      source: GalleryItem,
      options: { resetCaptionContent?: boolean; preserveSelection?: boolean } = {},
    ) => {
      const cachedCaption = source.description ?? "";
      const cachedBboxes = source.bboxes ?? [];
      const preserveSelection = options.preserveSelection ?? true;

      setCaption(cachedCaption);
      setBboxes(cachedBboxes);
      setSelectedBboxIndex((current) =>
        nextSelectedBboxIndex(current, cachedBboxes.length, preserveSelection),
      );
      // Browse items do not carry caption_content; only clear it on full item reload.
      if (options.resetCaptionContent) {
        setCaptionContent(null);
      }
      setBaseline({ path: source.path, text: cachedCaption, bboxes: cachedBboxes });
      captionRevisionRef.current = itemCaptionRevision(source);
    },
    [setBaseline],
  );

  useEffect(() => {
    if (!itemPath || !item) return;

    if (autoSave) {
      flushPendingSave();
    }
    invalidateInFlight();
    applyCaptionFromItem(item, { resetCaptionContent: true, preserveSelection: false });

    const requestId = next();

    const cancelDeferredCaptionLoad = deferNonCriticalWork(() => {
      void fetchCaption(itemPath)
        .then((fresh) => {
          if (!isCurrent(requestId)) return;

          const caption = fresh.description ?? "";
          const bboxes = fresh.bboxes ?? [];
          setCaption(caption);
          setBboxes(bboxes);
          setSelectedBboxIndex((current) => nextSelectedBboxIndex(current, bboxes.length, true));
          setBaseline({ path: itemPath, text: caption, bboxes });
          setCaptionContent(fresh.caption_content ?? null);
          captionRevisionRef.current = revisionFromSaveResult(fresh);
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
    invalidateInFlight,
    itemPath,
    onCaptionSaved,
    setBaseline,
  ]);

  useEffect(() => {
    if (!itemPath || !item || itemRevision === null) return;

    if (captionRevisionRef.current === itemRevision) return;

    const hadPreviousRevision = captionRevisionRef.current !== null;
    captionRevisionRef.current = itemRevision;

    if (!hadPreviousRevision) return;

    if (
      hasUnsavedChanges({
        path: itemPath,
        text: captionRef.current,
        bboxes: bboxesRef.current,
      })
    ) {
      return;
    }

    const incomingCaption = item.description ?? "";
    const incomingBboxes = item.bboxes ?? [];
    const current = captionRef.current;
    if (
      (current === incomingCaption || current.trim() === incomingCaption) &&
      bboxesEqual(bboxesRef.current, incomingBboxes)
    ) {
      // Browse echoed our own save (possibly after server-side whitespace normalization).
      // Keep the editor's exact buffer (e.g. trailing spaces while typing) and baseline.
      return;
    }

    // Keep caption_content from the last fetch/save — browse items never include it.
    applyCaptionFromItem(item, { resetCaptionContent: false, preserveSelection: true });
  }, [applyCaptionFromItem, hasUnsavedChanges, item, itemPath, itemRevision]);

  const handleCaptionChange = useCallback(
    (value: string) => {
      if (!item) return;
      setCaption(value);
      if (!autoSave) return;
      // Send a normalized (trimmed) version for save so that the persisted
      // value and server echoes match the backend normalization. The local
      // `caption` buffer retains the user's exact input (including temporary
      // trailing whitespace) for a smooth typing experience.
      scheduleSave({
        path: item.path,
        text: value.trim(),
        bboxes: bboxesEditable ? bboxes : undefined,
      });
    },
    [autoSave, bboxesEditable, bboxes, item, scheduleSave],
  );

  const handleBboxesChange = useCallback(
    (nextBboxes: CaptionBBox[]) => {
      if (!item) return;
      setBboxes(nextBboxes);
      if (!autoSave) return;
      // Normalize caption text for the save payload (see handleCaptionChange).
      scheduleSave({ path: item.path, text: caption.trim(), bboxes: nextBboxes });
    },
    [autoSave, caption, item, scheduleSave],
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
        const nextBboxes = result.bboxes ?? [];

        setCaption(nextCaption);
        setBboxes(nextBboxes);
        setSelectedBboxIndex((current) => nextSelectedBboxIndex(current, nextBboxes.length, true));
        setCaptionContent(result.caption_content ?? null);
        setBaseline({ path: item.path, text: nextCaption, bboxes: nextBboxes });
        captionRevisionRef.current = revisionFromSaveResult(result);
        onCaptionSaved(item.path, result);
        setJsonSaveState("idle");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save .json caption";
        setJsonSaveState("error");
        setJsonSaveError(message);
        return false;
      }
    },
    [flushPendingSave, invalidateInFlight, item, onCaptionSaved, setBaseline],
  );

  const resetJsonSaveState = useCallback(() => {
    setJsonSaveState("idle");
    setJsonSaveError(null);
  }, []);

  return {
    caption,
    bboxes,
    selectedBboxIndex,
    setSelectedBboxIndex,
    captionContent,
    hasJsonCaption,
    bboxesEditable,
    saveState,
    saveError,
    handleCaptionChange,
    handleBboxesChange,
    handleJsonContentSave,
    jsonSaveState,
    jsonSaveError,
    resetJsonSaveState,
    flushPendingSave,
  };
}
