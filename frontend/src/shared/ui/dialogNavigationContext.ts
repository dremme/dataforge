import { createContext, type RefObject } from "react";

export interface DialogNavigationDraft {
  unsavedChanges: boolean;
  blocked: boolean;
  /** Attempts autosave before asking whether the remaining drafts may be discarded. */
  save?: () => Promise<boolean>;
  /** Prepares a route exit after manual drafts have been approved for discard. */
  beforeLeave?: () => Promise<boolean>;
  /** Runs after every route blocker has allowed navigation to the requested destination. */
  onDiscard?: () => void;
}

export const DialogNavigationContext = createContext<{
  register: (draft: RefObject<DialogNavigationDraft>) => () => void;
  approved: () => boolean;
} | null>(null);
