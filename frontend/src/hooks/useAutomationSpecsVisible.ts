import { useCallback, useEffect, useState } from "react";
import {
  loadUiSettings,
  readCachedAutomationSpecsPreference,
  updateUiSettings,
} from "../uiPreferences";

export function useAutomationSpecsVisible() {
  const [showSpecs, setShowSpecsState] = useState(
    () => readCachedAutomationSpecsPreference() ?? false,
  );

  useEffect(() => {
    let cancelled = false;

    loadUiSettings().then((settings) => {
      if (!cancelled) {
        setShowSpecsState(settings.showAutomationSpecs);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setShowSpecs = useCallback((value: boolean) => {
    setShowSpecsState(value);
    updateUiSettings({ showAutomationSpecs: value }).catch(() => {
      // UI already reflects the choice; ignore persistence failures.
    });
  }, []);

  const toggleSpecs = useCallback(() => {
    setShowSpecsState((current) => {
      const next = !current;
      updateUiSettings({ showAutomationSpecs: next }).catch(() => {
        // UI already reflects the choice; ignore persistence failures.
      });
      return next;
    });
  }, []);

  return { showSpecs, setShowSpecs, toggleSpecs };
}
