import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrainingTemplate } from "@/features/automation/api/jobs";
import { formatApiError, isAbortError } from "@/shared/api/http";
import type { TrainingModel } from "@/shared/types";

/**
 * Per-model template drafts for one open training dialog.
 *
 * Drafts are keyed by model so switching tiles never discards an edit: each model keeps
 * its own draft for as long as the dialog is open, and neither is written to disk. A
 * model with no entry runs its shipped template, which is what `null` means on the wire.
 */
export function useTrainingTemplateDraft(model: TrainingModel) {
  const [stock, setStock] = useState<Partial<Record<TrainingModel, string>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<TrainingModel, string>>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const openEditor = useCallback(async () => {
    setLoadError(null);
    if (stock[model] !== undefined) {
      setEditorOpen(true);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const yaml = await fetchTrainingTemplate(model);
      if (controller.signal.aborted) return;
      setStock((current) => ({ ...current, [model]: yaml }));
      setEditorOpen(true);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setLoadError(formatApiError(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [model, stock]);

  const closeEditor = useCallback(() => setEditorOpen(false), []);

  const applyTemplate = useCallback(
    (template: string | null) => {
      setDrafts((current) => {
        const next = { ...current };
        // `null` means "back to stock", so drop the entry rather than storing a copy of
        // the shipped template — that is what keeps `edited` honest.
        if (template === null) delete next[model];
        else next[model] = template;
        return next;
      });
      setEditorOpen(false);
    },
    [model],
  );

  return {
    /** What to send for the current model: the edited YAML, or null for the stock one. */
    template: drafts[model] ?? null,
    edited: drafts[model] !== undefined,
    stockTemplate: stock[model] ?? "",
    editorOpen,
    loading,
    loadError,
    openEditor,
    closeEditor,
    applyTemplate,
  };
}
