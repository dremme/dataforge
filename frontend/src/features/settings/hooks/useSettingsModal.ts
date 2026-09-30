import { useCallback, useState } from "react";
import { useGlobalShortcut } from "@/shared/hooks/useGlobalShortcut";
import { SHORTCUTS } from "@/shared/lib/shortcuts";

export function useSettingsModal() {
  const [open, setOpen] = useState(false);

  const openSettings = useCallback(() => setOpen(true), []);
  const closeSettings = useCallback(() => setOpen(false), []);

  useGlobalShortcut(SHORTCUTS.settings, openSettings, { inEditable: true });

  return { open, openSettings, closeSettings };
}
