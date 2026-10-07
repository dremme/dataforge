import { useCallback, useRef } from "react";

export type WorkspaceAction = () => void | Promise<void>;
export type WorkspaceTransition = (action: WorkspaceAction) => Promise<void>;

export function useWorkspaceTransitions() {
  const transitionRef = useRef<WorkspaceTransition | null>(null);
  const requestTransition = useCallback(async (action: WorkspaceAction) => {
    if (transitionRef.current) await transitionRef.current(action);
    else await action();
  }, []);
  return { transitionRef, requestTransition };
}
