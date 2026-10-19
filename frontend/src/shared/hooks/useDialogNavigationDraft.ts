import { useContext, useEffect } from "react";
import {
  DialogNavigationContext,
  type DialogNavigationDraft,
} from "@/shared/ui/dialogNavigationContext";
import { useLatestRef } from "./useLatestRef";

export function useDialogNavigationDraft(options: DialogNavigationDraft) {
  const navigation = useContext(DialogNavigationContext);
  const draft = useLatestRef(options);
  useEffect(() => navigation?.register(draft), [draft, navigation]);
}
