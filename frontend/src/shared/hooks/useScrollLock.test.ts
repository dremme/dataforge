import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "./scrollLockManager";
import { useScrollLock } from "./useScrollLock";

describe("useScrollLock", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
    document.documentElement.className = "";
    document.body.style.paddingRight = "";
  });

  it("does not block wheel events inside data-scroll-lock-allow regions", () => {
    const scrollHost = document.createElement("main");
    scrollHost.className = "main";
    document.body.appendChild(scrollHost);

    const allowed = document.createElement("div");
    allowed.setAttribute("data-scroll-lock-allow", "");
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 100 });
    scroller.appendChild(document.createElement("p"));
    allowed.appendChild(scroller);
    scrollHost.appendChild(allowed);

    renderHook(() => useScrollLock(true, "sysprompt-modal-open", { current: scrollHost }));

    const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(wheel, "preventDefault");

    scroller.dispatchEvent(wheel);

    expect(preventDefault).not.toHaveBeenCalled();

    scrollHost.remove();
  });

  it("does not block wheel events on CodeMirror scrollers", () => {
    const scrollHost = document.createElement("main");
    scrollHost.className = "main";
    document.body.appendChild(scrollHost);

    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 200 });
    scroller.appendChild(document.createElement("p"));
    scrollHost.appendChild(scroller);

    renderHook(() => useScrollLock(true, "gallery-item-modal-open", { current: scrollHost }));

    const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(wheel, "preventDefault");

    scroller.dispatchEvent(wheel);

    expect(preventDefault).not.toHaveBeenCalled();

    scrollHost.remove();
  });

  it("blocks wheel events outside data-scroll-lock-allow regions", () => {
    const scrollHost = document.createElement("main");
    scrollHost.className = "main";
    document.body.appendChild(scrollHost);

    renderHook(() => useScrollLock(true, "sysprompt-modal-open", { current: scrollHost }));

    const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(wheel, "preventDefault");

    scrollHost.dispatchEvent(wheel);

    expect(preventDefault).toHaveBeenCalled();

    scrollHost.remove();
  });

  it("shares one wheel listener across nested hooks", () => {
    const addSpy = vi.spyOn(document, "addEventListener");

    const first = renderHook(() => useScrollLock(true, "gallery-item-modal-open"));
    const second = renderHook(() => useScrollLock(true, "confirm-dialog-open"));

    const wheelAdds = addSpy.mock.calls.filter(([eventName]) => eventName === "wheel");
    expect(wheelAdds).toHaveLength(1);
    expect(document.documentElement.classList.contains("confirm-dialog-open")).toBe(true);

    second.unmount();
    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(true);

    first.unmount();
    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(false);
  });

  it("updates the lock class without releasing the handle", () => {
    const { rerender } = renderHook(
      ({ lockClass }: { lockClass: "gallery-item-modal-open" | "issue-resolver-modal-open" }) =>
        useScrollLock(true, lockClass),
      { initialProps: { lockClass: "gallery-item-modal-open" } },
    );

    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(true);

    rerender({ lockClass: "issue-resolver-modal-open" });
    expect(document.documentElement.classList.contains("gallery-item-modal-open")).toBe(false);
    expect(document.documentElement.classList.contains("issue-resolver-modal-open")).toBe(true);
  });
});
