import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireScrollLock,
  getScrollLockDepth,
  isNestedOverlay,
  releaseScrollLock,
  resetScrollLockManagerForTests,
  updateScrollLockClass,
} from "./scrollLockManager";

describe("scrollLockManager", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
    document.documentElement.className = "";
    document.body.style.paddingRight = "";
  });

  it("tracks depth and nested overlay state", () => {
    expect(getScrollLockDepth()).toBe(0);
    expect(isNestedOverlay()).toBe(false);

    const first = acquireScrollLock("gallery-item-modal-open");
    expect(getScrollLockDepth()).toBe(1);
    expect(isNestedOverlay()).toBe(true);

    const second = acquireScrollLock("confirm-dialog-open");
    expect(getScrollLockDepth()).toBe(2);

    releaseScrollLock(second);
    expect(getScrollLockDepth()).toBe(1);
    expect(isNestedOverlay()).toBe(true);

    releaseScrollLock(first);
    expect(getScrollLockDepth()).toBe(0);
  });

  it("applies only the topmost lock class on documentElement", () => {
    const first = acquireScrollLock("gallery-item-modal-open");
    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(true);

    const second = acquireScrollLock("confirm-dialog-open");
    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(false);
    expect(document.documentElement.classList.contains("confirm-dialog-open")).toBe(true);

    releaseScrollLock(second);
    expect(document.documentElement.classList.contains("confirm-dialog-open")).toBe(false);
    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(true);

    releaseScrollLock(first);
    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(false);
  });

  it("updates the lock class for an existing handle", () => {
    const handle = acquireScrollLock("gallery-item-modal-open");
    updateScrollLockClass(handle, "issue-resolver-modal-open");

    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(false);
    expect(document.documentElement.classList.contains("issue-resolver-modal-open")).toBe(true);
  });

  it("attaches a single wheel listener for nested locks", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const first = acquireScrollLock("gallery-item-modal-open");
    const second = acquireScrollLock("confirm-dialog-open");

    const wheelAdds = addSpy.mock.calls.filter(([eventName]) => eventName === "wheel");
    expect(wheelAdds).toHaveLength(1);

    releaseScrollLock(second);
    releaseScrollLock(first);

    const wheelRemoves = removeSpy.mock.calls.filter(([eventName]) => eventName === "wheel");
    expect(wheelRemoves).toHaveLength(1);
  });
});
