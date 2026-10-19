import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireScrollLock,
  getScrollLockDepth,
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

  it("tracks depth", () => {
    expect(getScrollLockDepth()).toBe(0);

    const first = acquireScrollLock("gallery-item-dialog-open");
    expect(getScrollLockDepth()).toBe(1);

    const second = acquireScrollLock("confirm-dialog-open");
    expect(getScrollLockDepth()).toBe(2);

    releaseScrollLock(second);
    expect(getScrollLockDepth()).toBe(1);

    releaseScrollLock(first);
    expect(getScrollLockDepth()).toBe(0);
  });

  it("applies only the topmost lock class on documentElement", () => {
    const first = acquireScrollLock("gallery-item-dialog-open");
    expect(document.documentElement.classList.contains("gallery-item-dialog-open")).toBe(true);

    const second = acquireScrollLock("confirm-dialog-open");
    expect(document.documentElement.classList.contains("gallery-item-dialog-open")).toBe(false);
    expect(document.documentElement.classList.contains("confirm-dialog-open")).toBe(true);

    releaseScrollLock(second);
    expect(document.documentElement.classList.contains("confirm-dialog-open")).toBe(false);
    expect(document.documentElement.classList.contains("gallery-item-dialog-open")).toBe(true);

    releaseScrollLock(first);
    expect(document.documentElement.classList.contains("gallery-item-dialog-open")).toBe(false);
  });

  it("updates the lock class for an existing handle", () => {
    const handle = acquireScrollLock("gallery-item-dialog-open");
    updateScrollLockClass(handle, "issue-resolver-dialog-open");

    expect(document.documentElement.classList.contains("gallery-item-dialog-open")).toBe(false);
    expect(document.documentElement.classList.contains("issue-resolver-dialog-open")).toBe(true);
  });

  it("attaches a single wheel listener for nested locks", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const first = acquireScrollLock("gallery-item-dialog-open");
    const second = acquireScrollLock("confirm-dialog-open");

    const wheelAdds = addSpy.mock.calls.filter(([eventName]) => eventName === "wheel");
    expect(wheelAdds).toHaveLength(1);

    releaseScrollLock(second);
    releaseScrollLock(first);

    const wheelRemoves = removeSpy.mock.calls.filter(([eventName]) => eventName === "wheel");
    expect(wheelRemoves).toHaveLength(1);
  });
});
