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
