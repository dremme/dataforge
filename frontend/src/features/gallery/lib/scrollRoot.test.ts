import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGalleryMediaZones,
  isElementInGalleryLoadZone,
  scrollContainerToTop,
} from "./scrollRoot";

describe("scrollContainerToTop", () => {
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

  it("pins the container at the top after animating long distances", () => {
    const scrollElement = document.createElement("main");
    Object.defineProperty(scrollElement, "scrollTop", {
      value: 8000,
      writable: true,
      configurable: true,
    });

    scrollContainerToTop(scrollElement);
    flushFrames(0);
    flushFrames(5000);
    flushFrames(5001);

    expect(scrollElement.scrollTop).toBe(0);
    expect(scrollElement.style.overflowAnchor).toBe("");
  });

  it("does nothing when the container is already at the top", () => {
    const scrollElement = document.createElement("main");
    Object.defineProperty(scrollElement, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });

    scrollContainerToTop(scrollElement);

    expect(rafCallbacks).toHaveLength(0);
  });
});

describe("isElementInGalleryLoadZone", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns false for zero-sized elements", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);

    expect(isElementInGalleryLoadZone(element, null, 0)).toBe(false);
  });

  it("detects when an element intersects the scroll root with margin", () => {
    const root = document.createElement("main");
    const element = document.createElement("div");
    root.style.height = "200px";
    element.getBoundingClientRect = () =>
      ({
        top: 150,
        bottom: 250,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 150,
        toJSON: () => ({}),
      }) as DOMRect;
    root.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 300,
        left: 0,
        right: 400,
        width: 400,
        height: 200,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    root.appendChild(element);
    document.body.appendChild(root);

    expect(isElementInGalleryLoadZone(element, root, 0)).toBe(true);

    element.getBoundingClientRect = () =>
      ({
        top: 420,
        bottom: 520,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 420,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(isElementInGalleryLoadZone(element, root, 0)).toBe(false);
    expect(isElementInGalleryLoadZone(element, root, 150)).toBe(true);
  });
});

describe("getGalleryMediaZones", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks in-viewport elements as visible and keeps them loaded longer", () => {
    const root = document.createElement("main");
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({
        top: 150,
        bottom: 250,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 150,
        toJSON: () => ({}),
      }) as DOMRect;
    root.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 300,
        left: 0,
        right: 400,
        width: 400,
        height: 200,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    root.appendChild(element);
    document.body.appendChild(root);

    expect(getGalleryMediaZones(element, root)).toEqual({
      shouldLoad: true,
      shouldKeep: true,
      priority: "visible",
    });
  });

  it("keeps prefetch items in the keep zone after they leave the load zone", () => {
    const root = document.createElement("main");
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({
        top: 20,
        bottom: 80,
        left: 0,
        right: 100,
        width: 100,
        height: 60,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    root.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 300,
        left: 0,
        right: 400,
        width: 400,
        height: 200,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    root.appendChild(element);
    document.body.appendChild(root);

    expect(getGalleryMediaZones(element, root)).toEqual({
      shouldLoad: true,
      shouldKeep: true,
      priority: "prefetch",
    });
  });
});
