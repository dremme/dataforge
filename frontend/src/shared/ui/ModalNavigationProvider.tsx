import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { DiscardChangesModal } from "./Modal";
import {
  ModalNavigationContext,
  ModalNavigationPendingContext,
  type ModalNavigationDraft,
} from "./modalNavigationContext";

/** History navigation discards every open modal together, including suspended parent drafts. */
export function ModalNavigationProvider({ children }: { children: ReactNode }) {
  const { history } = useRouter();
  const draftsRef = useRef(new Set<RefObject<ModalNavigationDraft>>());
  const pendingRef = useRef<((discard: boolean) => void) | null>(null);
  const approvedHrefRef = useRef<string | null>(null);
  const discardRef = useRef<(() => void)[]>([]);
  const phaseRef = useRef<"guard" | "handoff" | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const register = useCallback((draft: RefObject<ModalNavigationDraft>) => {
    draftsRef.current.add(draft);
    return () => {
      draftsRef.current.delete(draft);
    };
  }, []);
  const approved = useCallback(() => approvedHrefRef.current === history.location.href, [history]);
  const context = useMemo(() => ({ register, approved }), [approved, register]);
  const decide = (discard: boolean) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setConfirming(false);
    resolve?.(discard);
  };

  useLayoutEffect(() => {
    const unblock = history.block({
      blockerFn: async ({ action, currentLocation, nextLocation }) => {
        // Pushes go through their action's guard; replaces also update saved editor addresses.
        if (action === "PUSH" || action === "REPLACE" || currentLocation.href === nextLocation.href)
          return false;
        const drafts = [...draftsRef.current];
        if (phaseRef.current || drafts.some((draft) => draft.current.blocked)) return true;
        if (drafts.length === 0) return false;
        phaseRef.current = "guard";
        setNavigating(true);
        const saved = new Set<RefObject<ModalNavigationDraft>>();
        for (const draft of drafts) {
          if (draft.current.unsavedChanges && draft.current.save && (await draft.current.save())) {
            saved.add(draft);
          }
        }
        const dirty = drafts.filter((draft) => draft.current.unsavedChanges && !saved.has(draft));
        const discard =
          dirty.length === 0 ||
          (await new Promise<boolean>((resolve) => {
            pendingRef.current = resolve;
            setConfirming(true);
          }));
        if (discard) {
          approvedHrefRef.current = nextLocation.href;
          discardRef.current = dirty.flatMap((draft) =>
            draft.current.onDiscard ? [draft.current.onDiscard] : [],
          );
        }
        phaseRef.current = "handoff";
        return !discard;
      },
      enableBeforeUnload: () =>
        [...draftsRef.current].some((draft) => draft.current.unsavedChanges),
    });
    const unsubscribe = history.subscribe(({ action }) => {
      // A blocked pop also notifies. Discard only after every blocker allowed the destination.
      if (action.type === "PUSH" || action.type === "REPLACE" || phaseRef.current !== "handoff")
        return;
      if (approvedHrefRef.current === history.location.href) {
        for (const discard of discardRef.current) discard();
      }
      discardRef.current = [];
      phaseRef.current = null;
      setNavigating(false);
      // Folder subscribers may invoke the gallery's leave guard during this same transition.
      queueMicrotask(() => {
        approvedHrefRef.current = null;
      });
    });
    return () => {
      unblock();
      unsubscribe();
    };
  }, [history]);

  useEffect(
    () => () => {
      pendingRef.current?.(false);
      pendingRef.current = null;
    },
    [],
  );

  return (
    <ModalNavigationContext.Provider value={context}>
      <ModalNavigationPendingContext.Provider value={navigating}>
        {children}
      </ModalNavigationPendingContext.Provider>
      {confirming && (
        <DiscardChangesModal
          description="Unsaved changes in the open modals will be lost. This cannot be undone."
          onDiscard={() => decide(true)}
          onKeepEditing={() => decide(false)}
        />
      )}
    </ModalNavigationContext.Provider>
  );
}
