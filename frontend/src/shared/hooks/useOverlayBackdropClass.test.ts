import { afterEach, describe, expect, it } from "vitest";
import {
  acquireScrollLock,
  getScrollLockDepth,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "./scrollLockManager";
import { overlayBackdropClass } from "./useOverlayBackdropClass";

describe("overlayBackdropClass", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("returns the base class when not nested", () => {
    expect(overlayBackdropClass("confirm-modal__backdrop", false)).toBe("confirm-modal__backdrop");
  });

  it("adds the nested modifier when nested", () => {
    expect(overlayBackdropClass("confirm-modal__backdrop", true)).toBe(
      "confirm-modal__backdrop confirm-modal__backdrop--nested",
    );
  });

  it("detects nesting from scroll-lock depth at mount time", () => {
    const handle = acquireScrollLock("gallery-item-modal-open");

    expect(overlayBackdropClass("confirm-modal__backdrop", getScrollLockDepth() > 0)).toBe(
      "confirm-modal__backdrop confirm-modal__backdrop--nested",
    );

    releaseScrollLock(handle);
  });
});
