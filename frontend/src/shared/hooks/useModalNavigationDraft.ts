import { useContext, useEffect } from "react";
import {
  ModalNavigationContext,
  type ModalNavigationDraft,
} from "@/shared/ui/modalNavigationContext";
import { useLatestRef } from "./useLatestRef";

export function useModalNavigationDraft(options: ModalNavigationDraft) {
  const navigation = useContext(ModalNavigationContext);
  const draft = useLatestRef(options);
  useEffect(() => navigation?.register(draft), [draft, navigation]);
}
