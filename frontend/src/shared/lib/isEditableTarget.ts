/**
 * True when a keyboard event originated in a text-entry surface.
 * Global shortcuts check this so typing in a field never triggers navigation.
 * CodeMirror renders a contenteditable inside `.cm-content`.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest(".cm-content") != null))
  );
}
