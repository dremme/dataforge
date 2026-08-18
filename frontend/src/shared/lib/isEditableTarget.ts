/**
 * True when a keyboard event originated somewhere that owns its own keys.
 * Global shortcuts check this so typing in a field never triggers navigation.
 * CodeMirror renders a contenteditable inside `.cm-content`.
 *
 * A focused slider counts too: arrows step its value everywhere in the app, so letting
 * them also reach a global handler would nudge a trim handle and move to the next
 * gallery item in the same keystroke.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(".cm-content") != null ||
        target.closest('[role="slider"]') != null))
  );
}
