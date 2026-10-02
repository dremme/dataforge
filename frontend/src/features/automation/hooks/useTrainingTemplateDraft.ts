import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTrainingTemplate } from "@/features/automation/api/jobs";
import { formatApiError } from "@/shared/api/http";
import type { TrainingModel } from "@/shared/types";

/** A shipped template does not change while the app runs, so each is read at most once. */
function stockTemplateQuery(model: TrainingModel) {
  return {
    queryKey: ["training-template", model] as const,
    queryFn: () => fetchTrainingTemplate(model),
    staleTime: Infinity,
  };
}

export function useTrainingTemplateDraft(model: TrainingModel) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Partial<Record<TrainingModel, string>>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  // Read only when the editor is asked for; this just follows what is already cached.
  const { data: stockTemplate } = useQuery({ ...stockTemplateQuery(model), enabled: false });

  const openEditor = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      await queryClient.fetchQuery(stockTemplateQuery(model));
      // A model picked while the template loaded opens nothing; its own click will.
      if (modelRef.current === model) setEditorOpen(true);
    } catch (cause) {
      setLoadError(formatApiError(cause));
    } finally {
      setLoading(false);
    }
  }, [model, queryClient]);

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
    stockTemplate: stockTemplate ?? "",
    editorOpen,
    loading,
    loadError,
    openEditor,
    closeEditor,
    applyTemplate,
  };
}
