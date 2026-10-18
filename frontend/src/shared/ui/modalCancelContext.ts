import { createContext } from "react";
import type { GuardedAction } from "@/shared/hooks/useDiscardChanges";

export const ModalCancelContext = createContext<((action: GuardedAction) => Promise<void>) | null>(
  null,
);
