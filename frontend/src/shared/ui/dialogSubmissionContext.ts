import { createContext } from "react";

export const DialogSubmissionContext = createContext<{
  confirm: () => void;
  busy: boolean;
  disabled: boolean;
} | null>(null);
