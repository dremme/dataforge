// jsdom has no modal lifecycle. Browser E2E tests cover native focus containment and inertness.
const dialogs: HTMLDialogElement[] = [];
const openers = new WeakMap<HTMLDialogElement, Element | null>();

HTMLDialogElement.prototype.showModal = function () {
  if (this.open) return;
  openers.set(this, document.activeElement);
  this.open = true;
  // jsdom requires tabindex for programmatic focus, unlike native dialog elements.
  this.tabIndex = -1;
  dialogs.push(this);
};

HTMLDialogElement.prototype.close = function () {
  if (!this.open) return;
  this.open = false;
  const index = dialogs.indexOf(this);
  if (index !== -1) dialogs.splice(index, 1);
  const opener = openers.get(this);
  if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  this.dispatchEvent(new Event("close"));
};

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  // Native cancel follows keydown, after menus or editors have had a chance to prevent it.
  queueMicrotask(() => {
    if (event.defaultPrevented) return;
    const dialog = dialogs.filter((entry) => entry.open && entry.isConnected).at(-1);
    if (!dialog) return;
    if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
  });
});
