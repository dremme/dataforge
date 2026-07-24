import { getAppScrollElement } from "../gallery/layout";

const SCROLL_LOCK_ALLOW_SELECTOR = "[data-scroll-lock-allow]";
const CODE_MIRROR_SCROLLER_CLASS = "cm-scroller";

export const SCROLL_LOCK_CLASSES = [
  "gallery-item-modal-open",
  "gallery-item-json-editor-open",
  "sysprompt-modal-open",
  "confirm-dialog-open",
  "folder-picker-open",
  "jobs-drawer-open",
] as const;

export type ScrollLockClass = (typeof SCROLL_LOCK_CLASSES)[number];

type ScrollLockEntry = {
  handle: symbol;
  lockClass: ScrollLockClass;
};

let entries: ScrollLockEntry[] = [];
let scrollElement: HTMLElement | null = null;
let savedScrollY = 0;
let listenersAttached = false;

function isAllowedScrollTarget(event: WheelEvent | TouchEvent): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    if (node.matches(SCROLL_LOCK_ALLOW_SELECTOR)) {
      return true;
    }
    if (node.classList.contains(CODE_MIRROR_SCROLLER_CLASS)) {
      return true;
    }
  }
  return false;
}

function preventScroll(event: WheelEvent | TouchEvent): void {
  if (isAllowedScrollTarget(event)) {
    return;
  }

  event.preventDefault();
}

function attachListeners(): void {
  if (listenersAttached) return;

  document.addEventListener("wheel", preventScroll, { passive: false });
  document.addEventListener("touchmove", preventScroll, { passive: false });
  listenersAttached = true;
}

function detachListeners(): void {
  if (!listenersAttached) return;

  document.removeEventListener("wheel", preventScroll);
  document.removeEventListener("touchmove", preventScroll);
  listenersAttached = false;
}

function applyDomLock(): void {
  const { body, documentElement } = document;

  if (scrollElement) {
    const scrollbarWidth = scrollElement.offsetWidth - scrollElement.clientWidth;
    if (scrollbarWidth > 0) {
      scrollElement.style.paddingRight = `${scrollbarWidth}px`;
    }
    scrollElement.style.overflow = "hidden";
  } else {
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
}

function removeDomLock(): void {
  const { body, documentElement } = document;

  for (const lockClass of SCROLL_LOCK_CLASSES) {
    documentElement.classList.remove(lockClass);
  }

  if (scrollElement) {
    scrollElement.style.overflow = "";
    scrollElement.style.paddingRight = "";
    if (scrollElement.scrollTop !== savedScrollY) {
      scrollElement.scrollTop = savedScrollY;
    }
  } else {
    body.style.paddingRight = "";
    if (window.scrollY !== savedScrollY) {
      window.scrollTo(0, savedScrollY);
    }
  }
}

function syncLockClass(): void {
  const { documentElement } = document;

  for (const lockClass of SCROLL_LOCK_CLASSES) {
    documentElement.classList.remove(lockClass);
  }

  const top = entries.at(-1);
  if (top) {
    documentElement.classList.add(top.lockClass);
  }
}

export function getScrollLockDepth(): number {
  return entries.length;
}

export function isNestedOverlay(): boolean {
  return getScrollLockDepth() > 0;
}

export function acquireScrollLock(
  lockClass: ScrollLockClass,
  scrollElementOverride?: HTMLElement | null,
): symbol {
  const handle = Symbol("scroll-lock");
  const isFirst = entries.length === 0;

  entries.push({ handle, lockClass });

  if (isFirst) {
    scrollElement = scrollElementOverride ?? getAppScrollElement();
    savedScrollY = scrollElement?.scrollTop ?? window.scrollY;
    applyDomLock();
    attachListeners();
  }

  syncLockClass();
  return handle;
}

export function updateScrollLockClass(handle: symbol, lockClass: ScrollLockClass): void {
  const entry = entries.find((item) => item.handle === handle);
  if (!entry) return;

  entry.lockClass = lockClass;
  syncLockClass();
}

export function releaseScrollLock(handle: symbol): void {
  const index = entries.findIndex((item) => item.handle === handle);
  if (index === -1) return;

  entries.splice(index, 1);

  if (entries.length === 0) {
    detachListeners();
    removeDomLock();
    scrollElement = null;
    return;
  }

  syncLockClass();
}

export function resetScrollLockManagerForTests(): void {
  entries = [];
  detachListeners();
  removeDomLock();
  scrollElement = null;
  savedScrollY = 0;
}
