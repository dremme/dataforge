import { createContext, type RefObject } from "react";

/** Anchored content belongs inside its native modal; child dialogs open above it. */
export const DialogHostContext = createContext<RefObject<HTMLDialogElement | null> | null>(null);
