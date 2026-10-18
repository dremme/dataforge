import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ModalNavigationContext,
  ModalNavigationPendingContext,
} from "@/shared/ui/modalNavigationContext";
import { useModalNavigationDraft } from "./useModalNavigationDraft";

export type GuardedAction = () => void | Promise<void>;

/** Holds one requested transition until its draft is explicitly discarded or kept. */
export function useDiscardChanges(
  unsavedChanges: boolean,
  blocked = false,
  navigationBlocked = blocked,
  onNavigationDiscard?: () => void,
) {
  const [confirming, setConfirming] = useState(false);
  const pendingRef = useRef<((discard: boolean) => void) | null>(null);
  const navigation = useContext(ModalNavigationContext);
  const navigationPending = useContext(ModalNavigationPendingContext);
  useModalNavigationDraft({
    unsavedChanges,
    blocked: navigationBlocked || confirming,
    onDiscard: onNavigationDiscard,
  });

  const decide = useCallback((discard: boolean) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setConfirming(false);
    resolve?.(discard);
  }, []);

  const request = useCallback(
    async (action: GuardedAction) => {
      const approved = navigation?.approved();
      if (!approved && (blocked || navigationPending || pendingRef.current)) return;
      if (unsavedChanges && !approved) {
        const discard = await new Promise<boolean>((resolve) => {
          pendingRef.current = resolve;
          setConfirming(true);
        });
        if (!discard) return;
      }
      await action();
    },
    [blocked, navigation, navigationPending, unsavedChanges],
  );

  useEffect(
    () => () => {
      pendingRef.current?.(false);
      pendingRef.current = null;
    },
    [],
  );

  return { confirming, request, keepEditing: () => decide(false), discard: () => decide(true) };
}
