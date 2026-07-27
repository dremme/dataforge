/** Close an open CodeMirror find panel inside `root`. Returns true if one was open. */
export function closeCodeEditorSearchPanel(root: ParentNode | null | undefined): boolean {
  const closeButton = root?.querySelector<HTMLElement>(".cm-panel.cm-search [name=close]");
  if (!closeButton) return false;
  closeButton.click();
  return true;
}
