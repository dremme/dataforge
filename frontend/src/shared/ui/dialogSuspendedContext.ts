import { createContext } from "react";

/**
 * True while dialogs below must not act: a browser navigation is deciding their drafts' fate,
 * or an ancestor is resolving its own exit.
 */
export const DialogSuspendedContext = createContext(false);
