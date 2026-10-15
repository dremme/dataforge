/** Input types with no text, and so no undo history of their own. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "radio",
  "range",
  "reset",
  "submit",
]);

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

/** A field being typed in, which keeps keys like Ctrl+Z for its own text. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type)) ||
    (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest(".cm-content") != null))
  );
}
