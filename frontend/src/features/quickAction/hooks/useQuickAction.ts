import { useCallback, useState } from "react";
import { useGlobalShortcut } from "@/shared/hooks/useGlobalShortcut";
import { getScrollLockDepth } from "@/shared/hooks/scrollLockManager";
import { SHORTCUTS } from "@/shared/lib/shortcuts";

export function useQuickAction() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Swallowed even under another overlay: the browser's print dialog is never the intent here.
  useGlobalShortcut(
    SHORTCUTS.commandPalette,
    // Open is checked before the lock depth; this palette holds a lock of its own.
    () => {
      const unlocked = getScrollLockDepth() === 0;
      setOpen((current) => !current && unlocked);
    },
    { whenLocked: true, inEditable: true },
  );

  return { open, close };
}
