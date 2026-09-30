import { useCallback, useState } from "react";
import { useGlobalShortcut } from "@/shared/hooks/useGlobalShortcut";
import { SHORTCUTS } from "@/shared/lib/shortcuts";

export function useShortcutsDialog() {
  const [open, setOpen] = useState(false);

  const openShortcuts = useCallback(() => setOpen(true), []);
  const closeShortcuts = useCallback(() => setOpen(false), []);

  useGlobalShortcut(SHORTCUTS.shortcuts, openShortcuts);

  return { open, openShortcuts, closeShortcuts };
}
