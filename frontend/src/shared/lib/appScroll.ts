/** Selector for the primary app scroll container (.main). */
const APP_SCROLL_SELECTOR = ".main";

export function getAppScrollElement(): HTMLElement | null {
  return document.querySelector(APP_SCROLL_SELECTOR);
}
