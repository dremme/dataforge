import { useCallback, useEffect, useRef, useState } from "react";
import { rescaleAuto, withAuto, withoutAuto } from "@/features/gallery/lib/autoAdjust";
import { RESTING_ADJUST, type AdjustTool } from "@/features/gallery/lib/colorAdjust";
import { formatApiError } from "@/shared/api/http";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";
import { useNotify } from "@/shared/notifications/notifications";
import type { AutoAdjust, ColorAdjust } from "@/shared/types";

export interface AdjustDraft {
  adjust: ColorAdjust;
  autoAdjust: AutoAdjust | null;
}

export interface ColorAdjustControls {
  values: ColorAdjust;
  auto: AutoAdjust | null;
  autoPending: boolean;
  active: boolean;
  comparing: boolean;
  zoomed: boolean;
  previewAvailable: boolean;
  setActive: (active: boolean) => void;
  setComparing: (comparing: boolean) => void;
  setZoomed: (zoomed: boolean) => void;
  setPreviewAvailable: (available: boolean) => void;
  set: (tool: AdjustTool, value: number) => void;
  reset: () => void;
  cancelAuto: () => void;
  activateAuto: () => void;
  deactivateAuto: () => void;
  setAutoAmount: (amount: number) => void;
}

interface UseColorAdjustOptions {
  draft: AdjustDraft;
  update: (change: (current: AdjustDraft) => AdjustDraft) => void;
  path: string | undefined;
  name: string | undefined;
  requestSuggestion: (path: string) => Promise<ColorAdjust>;
}

export function useColorAdjust({
  draft,
  update,
  path,
  name,
  requestSuggestion,
}: UseColorAdjustOptions): ColorAdjustControls {
  const notify = useNotify();
  const { next, isCurrent, invalidate } = useStaleRequest();
  const [autoPending, setAutoPending] = useState(false);
  const [active, setActive] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [previewAvailable, setPreviewAvailable] = useState(true);

  const requestRef = useRef(requestSuggestion);
  requestRef.current = requestSuggestion;

  useEffect(() => {
    invalidate();
    setAutoPending(false);
    setComparing(false);
    setZoomed(false);
  }, [path, invalidate]);

  useEffect(() => {
    if (!active) {
      setZoomed(false);
      setComparing(false);
    }
  }, [active]);

  useEffect(() => invalidate, [invalidate]);

  const set = useCallback(
    (tool: AdjustTool, value: number) => {
      update((current) => ({ ...current, adjust: { ...current.adjust, [tool]: value } }));
    },
    [update],
  );

  const cancelAuto = useCallback(() => {
    invalidate();
    setAutoPending(false);
  }, [invalidate]);

  const reset = useCallback(() => {
    cancelAuto();
    setComparing(false);
    update(() => ({ adjust: { ...RESTING_ADJUST }, autoAdjust: null }));
  }, [cancelAuto, update]);

  const activateAuto = useCallback(() => {
    if (!path) return;
    const request = next();
    setAutoPending(true);

    void (async () => {
      try {
        const suggestion = await requestRef.current(path);
        if (!isCurrent(request)) return;
        update((current) => {
          const base = current.autoAdjust
            ? withoutAuto(current.adjust, current.autoAdjust)
            : current.adjust;
          return withAuto(base, suggestion);
        });
      } catch (error) {
        if (!isCurrent(request)) return;
        notify({
          variant: "danger",
          message: `Could not analyse ${name ?? "this file"}: ${formatApiError(error)}`,
        });
      } finally {
        if (isCurrent(request)) setAutoPending(false);
      }
    })();
  }, [isCurrent, name, next, notify, path, update]);

  const deactivateAuto = useCallback(() => {
    cancelAuto();
    update((current) =>
      current.autoAdjust
        ? { adjust: withoutAuto(current.adjust, current.autoAdjust), autoAdjust: null }
        : current,
    );
  }, [cancelAuto, update]);

  const setAutoAmount = useCallback(
    (amount: number) => {
      update((current) =>
        current.autoAdjust ? rescaleAuto(current.adjust, current.autoAdjust, amount) : current,
      );
    },
    [update],
  );

  return {
    values: draft.adjust,
    auto: draft.autoAdjust,
    autoPending,
    active,
    comparing,
    zoomed,
    previewAvailable,
    setActive,
    setComparing,
    setZoomed,
    setPreviewAvailable,
    set,
    reset,
    cancelAuto,
    activateAuto,
    deactivateAuto,
    setAutoAmount,
  };
}
