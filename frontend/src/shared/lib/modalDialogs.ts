const dialogs = new Set<HTMLDialogElement>();
const listeners = new Set<() => void>();

function notify() {
  let index = 0;
  for (const dialog of dialogs) dialog.toggleAttribute("data-dialog-stacked", index++ > 0);
  for (const listener of listeners) listener();
}

/** Native top-layer order follows showModal calls, independently of portal DOM order. */
export function registerModalDialog(dialog: HTMLDialogElement) {
  dialogs.add(dialog);
  notify();
  return () => {
    dialogs.delete(dialog);
    notify();
  };
}

export function subscribeModalDialogs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTopModalDialog() {
  return [...dialogs].at(-1) ?? null;
}
