import { createContext } from "react";
import type { GuardedAction } from "@/shared/hooks/useDiscardChanges";

export const DialogCancelContext = createContext<((action: GuardedAction) => Promise<void>) | null>(
  null,
);
