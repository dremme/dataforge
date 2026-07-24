import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

const CODE_EDITOR_CONTENT_SELECTOR = '.code-editor .cm-content[contenteditable="true"]';

function isContentEditableFocusable(el: HTMLElement): boolean {
  return el.getAttribute("contenteditable") === "true";
}

function isVisibleFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  return true;
}

function isFocusableElement(el: HTMLElement): boolean {
  if (!isVisibleFocusable(el)) {
    return false;
  }

  if (el.matches(CODE_EDITOR_CONTENT_SELECTOR)) {
    return true;
  }

  if (!el.matches(FOCUSABLE_SELECTOR)) {
    return false;
  }

  if (!isContentEditableFocusable(el) && el.tabIndex < 0) {
    return false;
  }

  return true;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusables: HTMLElement[] = [];

  for (const el of container.querySelectorAll<HTMLElement>("*")) {
    if (isFocusableElement(el)) {
      focusables.push(el);
    }
  }

  return focusables;
}

function isCodeEditorFocus(el: HTMLElement, container: HTMLElement): boolean {
  if (!container.contains(el)) {
    return false;
  }

  const editor = el.closest(".code-editor");
  return editor != null && container.contains(editor);
}

function focusTarget(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;

      if (!activeEl || !container.contains(activeEl)) {
        event.preventDefault();
        focusTarget(focusables[0]);
        return;
      }

      if (isCodeEditorFocus(activeEl, container)) {
        return;
      }

      const currentIndex = focusables.indexOf(activeEl);
      if (currentIndex === -1) {
        return;
      }

      event.preventDefault();
      const nextIndex = event.shiftKey
        ? currentIndex === 0
          ? focusables.length - 1
          : currentIndex - 1
        : currentIndex === focusables.length - 1
          ? 0
          : currentIndex + 1;
      focusTarget(focusables[nextIndex]);
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [active, containerRef]);
}
