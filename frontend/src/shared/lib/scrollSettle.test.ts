import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleScrollPosition } from "./scrollSettle";

/**
 * jsdom has no layout, so `scrollTop` writes are no-ops. Install a stub that
 * clamps writes to `maxScrollTop` — that is exactly the behaviour a real
 * container has while its virtualized rows are still estimates.
 */
function createScrollElement(maxScrollTop: number) {
  const element = document.createElement("main");
  let current = 0;
  const state = {
    element,
    setMax(next: number) {
      maxScrollTop = next;
    },
  };

  Object.defineProperty(element, "scrollTop", {
    get: () => current,
    set: (value: number) => {
      current = Math.min(value, maxScrollTop);
    },
    configurable: true,
  });

  document.body.appendChild(element);
  return state;
}

describe("settleScrollPosition", () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafId: number;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      rafId += 1;
      return rafId;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const flushFrames = (now: number) => {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    vi.spyOn(performance, "now").mockReturnValue(now);
    for (const callback of callbacks) {
      callback(now);
    }
  };

  it("applies the target immediately when the container is already tall enough", () => {
    const { element } = createScrollElement(2000);

    settleScrollPosition(element, 900);

    expect(element.scrollTop).toBe(900);
  });

  it("keeps re-applying while the container is too short, then stops once it lands", () => {
    const scroll = createScrollElement(200);

    settleScrollPosition(scroll.element, 900);
    expect(scroll.element.scrollTop).toBe(200);

    flushFrames(16);
    expect(scroll.element.scrollTop).toBe(200);

    // Rows measure and the content grows.
    scroll.setMax(3000);
    flushFrames(32);
    expect(scroll.element.scrollTop).toBe(900);

    // One confirming frame, and then no further work is scheduled.
    flushFrames(48);
    expect(scroll.element.scrollTop).toBe(900);
    expect(rafCallbacks).toHaveLength(0);
  });

  it("leaves the container alone after landing, so the virtualizer can adjust", () => {
    const { element } = createScrollElement(3000);

    settleScrollPosition(element, 900);
    flushFrames(16);

    element.scrollTop = 880;
    flushFrames(32);

    expect(element.scrollTop).toBe(880);
  });

  it("gives up once the deadline passes", () => {
    const scroll = createScrollElement(200);

    settleScrollPosition(scroll.element, 900);
    flushFrames(1001);

    expect(rafCallbacks).toHaveLength(0);
    expect(scroll.element.style.overflowAnchor).toBe("");
  });

  it.each([
    ["wheel", () => new WheelEvent("wheel", { bubbles: true })],
    ["touchstart", () => new Event("touchstart", { bubbles: true })],
  ])("aborts on %s", (_name, createEvent) => {
    const scroll = createScrollElement(200);

    settleScrollPosition(scroll.element, 900);
    scroll.element.dispatchEvent(createEvent());

    scroll.setMax(3000);
    flushFrames(16);

    expect(scroll.element.scrollTop).toBe(200);
    expect(scroll.element.style.overflowAnchor).toBe("");
  });

  it("aborts on a keypress", () => {
    const scroll = createScrollElement(200);

    settleScrollPosition(scroll.element, 900);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));

    scroll.setMax(3000);
    flushFrames(16);

    expect(scroll.element.scrollTop).toBe(200);
  });

  it("aborts on a scrollbar mousedown but not on one inside the content", () => {
    const scroll = createScrollElement(200);
    const child = document.createElement("div");
    scroll.element.appendChild(child);

    settleScrollPosition(scroll.element, 900);

    child.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    scroll.setMax(3000);
    flushFrames(16);
    expect(scroll.element.scrollTop).toBe(900);

    const second = createScrollElement(200);
    settleScrollPosition(second.element, 900);
    second.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    second.setMax(3000);
    flushFrames(32);
    expect(second.element.scrollTop).toBe(200);
  });

  it("restores the overflow anchor and stops scheduling once cancelled", () => {
    const scroll = createScrollElement(200);
    scroll.element.style.overflowAnchor = "auto";

    const cancel = settleScrollPosition(scroll.element, 900);
    expect(scroll.element.style.overflowAnchor).toBe("none");

    cancel();
    expect(scroll.element.style.overflowAnchor).toBe("auto");

    scroll.setMax(3000);
    flushFrames(16);
    expect(scroll.element.scrollTop).toBe(200);
    expect(rafCallbacks).toHaveLength(0);
  });
});
