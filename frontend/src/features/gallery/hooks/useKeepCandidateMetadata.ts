import { useCallback } from "react";
import { useUiSettings, useUpdateUiSettings } from "@/shared/preferences/uiPreferences";

/** One remembered choice for every accept: the review modal and bulk accept share it. */
export function useKeepCandidateMetadata() {
  const keepMetadata = useUiSettings().keepCandidateMetadata;
  const updateUiSettings = useUpdateUiSettings();

  const setKeepMetadata = useCallback(
    (value: boolean) => updateUiSettings({ keepCandidateMetadata: value }),
    [updateUiSettings],
  );

  return { keepMetadata, setKeepMetadata };
}
