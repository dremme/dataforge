import { useCallback } from "react";
import { useUiSettings, useUpdateUiSettings } from "@/shared/preferences/uiPreferences";

export function useAutomationSpecsVisible() {
  const showSpecs = useUiSettings().showAutomationSpecs;
  const updateUiSettings = useUpdateUiSettings();

  const setShowSpecs = useCallback(
    (value: boolean) => updateUiSettings({ showAutomationSpecs: value }),
    [updateUiSettings],
  );

  const toggleSpecs = useCallback(
    () => updateUiSettings({ showAutomationSpecs: !showSpecs }),
    [showSpecs, updateUiSettings],
  );

  return { showSpecs, setShowSpecs, toggleSpecs };
}
