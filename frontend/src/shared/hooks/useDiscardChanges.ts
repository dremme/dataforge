import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { DialogNavigationContext } from "@/shared/ui/dialogNavigationContext";
import { DialogSuspendedContext } from "@/shared/ui/dialogSuspendedContext";
import { useDialogNavigationDraft } from "./useDialogNavigationDraft";

export type GuardedAction = () => void | Promise<void>;

interface DiscardChangesOptions {
  unsavedChanges: boolean;
  /** Ignores requests and holds browser navigation, e.g. while a save is writing. */
  busy?: boolean;
  /** Ignores requests while another overlay owns the dialog; navigation may still discard. */
  suspended?: boolean;
  /** Runs once browser navigation has discarded this draft. */
  onNavigationDiscard?: () => void;
  /** Replaces the prompt's default warning. */
  description?: string;
}

/** Holds one requested transition until its draft is explicitly discarded or kept. */
export function useDiscardChanges({
  unsavedChanges,
  busy = false,
  suspended = false,
  onNavigationDiscard,
  description,
}: DiscardChangesOptions) {
  const [confirming, setConfirming] = useState(false);
  const pendingRef = useRef<((discard: boolean) => void) | null>(null);
  const navigation = useContext(DialogNavigationContext);
  const parentSuspended = useContext(DialogSuspendedContext);
  const blocked = busy || suspended;
  useDialogNavigationDraft({
    unsavedChanges,
    blocked: busy || confirming,
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
      if (!approved && (blocked || parentSuspended || pendingRef.current)) return;
      if (unsavedChanges && !approved) {
        const discard = await new Promise<boolean>((resolve) => {
          pendingRef.current = resolve;
          setConfirming(true);
        });
        if (!discard) return;
      }
      await action();
    },
    [blocked, navigation, parentSuspended, unsavedChanges],
  );

  useEffect(
    () => () => {
      pendingRef.current?.(false);
      pendingRef.current = null;
    },
    [],
  );

  const promptProps = confirming
    ? { description, onDiscard: () => decide(true), onKeepEditing: () => decide(false) }
    : null;

  return { confirming, request, promptProps };
}
