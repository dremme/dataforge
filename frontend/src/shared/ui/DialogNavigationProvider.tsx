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
import { registerHistoryPopGuard } from "@/shared/lib/historyPopGate";
import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { DialogNavigationContext, type DialogNavigationDraft } from "./dialogNavigationContext";
import { DialogSuspendedContext } from "./dialogSuspendedContext";

/** History navigation discards every open dialog together, including suspended parent drafts. */
export function DialogNavigationProvider({ children }: { children: ReactNode }) {
  const { history } = useRouter();
  const draftsRef = useRef(new Set<RefObject<DialogNavigationDraft>>());
  const pendingRef = useRef<((discard: boolean) => void) | null>(null);
  const approvedHrefRef = useRef<string | null>(null);
  const discardRef = useRef<(() => void)[]>([]);
  const phaseRef = useRef<"guard" | "handoff" | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const register = useCallback((draft: RefObject<DialogNavigationDraft>) => {
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
    let targetIndex: number | null = null;
    let restoring: Promise<void> | null = null;
    let finishRestore: (() => void) | null = null;
    let previousDistance = 0;
    let rollbackIndex: number | null = null;
    const finishNavigation = () => {
      discardRef.current = [];
      targetIndex = null;
      phaseRef.current = null;
      setNavigating(false);
      // Folder subscribers may invoke the gallery's leave guard during this same transition.
      queueMicrotask(() => {
        approvedHrefRef.current = null;
      });
    };
    const holdDestination = (event: PopStateEvent) => {
      const index = window.history.state?.__TSR_index;
      if (typeof index !== "number") return;
      if (rollbackIndex !== null) {
        if (index === rollbackIndex) {
          rollbackIndex = null;
          finishNavigation();
        }
        return;
      }
      if (targetIndex === null) return;
      // A second native traversal must not roll the first blocker back to its source entry.
      event.stopImmediatePropagation();
      if (index === targetIndex) {
        const resolve = finishRestore;
        finishRestore = null;
        restoring = null;
        resolve?.();
      } else {
        const distance = Math.abs(targetIndex - index);
        const restore = !restoring || distance < previousDistance;
        if (!restoring)
          restoring = new Promise<void>((resolve) => {
            finishRestore = resolve;
          });
        previousDistance = distance;
        // More queued Back/Forward presses can move the starting point of our correction.
        if (restore) window.history.go(targetIndex - index);
      }
    };
    const removePopGuard = registerHistoryPopGuard(holdDestination);
    const unblock = history.block({
      blockerFn: async ({ action, currentLocation, nextLocation }) => {
        // Pushes go through their action's guard; replaces also update saved editor addresses.
        if (action === "PUSH" || action === "REPLACE" || currentLocation.href === nextLocation.href)
          return false;
        const drafts = [...draftsRef.current];
        if (phaseRef.current || drafts.some((draft) => draft.current.blocked)) return true;
        if (drafts.length === 0) return false;
        phaseRef.current = "guard";
        if (typeof window.history.state?.__TSR_index === "number") {
          targetIndex = nextLocation.state.__TSR_index;
        }
        setNavigating(true);
        const saved = new Set<RefObject<DialogNavigationDraft>>();
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
        let leave = discard;
        if (leave) {
          for (const draft of drafts) {
            if (draft.current.beforeLeave && !(await draft.current.beforeLeave())) {
              leave = false;
              break;
            }
          }
        }
        await restoring;
        restoring = null;
        if (leave) {
          approvedHrefRef.current = nextLocation.href;
          discardRef.current = dirty.flatMap((draft) =>
            draft.current.onDiscard ? [draft.current.onDiscard] : [],
          );
        } else {
          targetIndex = null;
        }
        phaseRef.current = "handoff";
        return !leave;
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
      const index = window.history.state?.__TSR_index;
      if (typeof index === "number" && index !== history.location.state.__TSR_index) {
        // A rejected pop notifies before the native rollback reaches the source entry.
        rollbackIndex = history.location.state.__TSR_index;
        return;
      }
      finishNavigation();
    });
    return () => {
      unblock();
      unsubscribe();
      removePopGuard();
      finishRestore?.();
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
    <DialogNavigationContext.Provider value={context}>
      <DialogSuspendedContext.Provider value={navigating}>
        {children}
      </DialogSuspendedContext.Provider>
      {confirming && (
        <DiscardChangesDialog
          description="Unsaved changes in the open dialogs will be lost. This cannot be undone."
          onDiscard={() => decide(true)}
          onKeepEditing={() => decide(false)}
        />
      )}
    </DialogNavigationContext.Provider>
  );
}
