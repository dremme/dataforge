import { createContext, type RefObject } from "react";

export interface ModalNavigationDraft {
  unsavedChanges: boolean;
  blocked: boolean;
  /** Attempts autosave before asking whether the remaining drafts may be discarded. */
  save?: () => Promise<boolean>;
  /** Runs after every route blocker has allowed navigation to the requested destination. */
  onDiscard?: () => void;
}

export const ModalNavigationContext = createContext<{
  register: (draft: RefObject<ModalNavigationDraft>) => () => void;
  approved: () => boolean;
} | null>(null);

export const ModalNavigationPendingContext = createContext(false);
