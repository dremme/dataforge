import { afterEach, expect, it, vi } from "vitest";
import { installThumbnailIntersections } from "@/test/thumbnailIntersections";
import { ThumbnailVisibility } from "./thumbnailVisibility";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("cancels pending layout measurements on disposal", () => {
  vi.useFakeTimers();
  const visibility = new ThumbnailVisibility();
  const listener = vi.fn();
  visibility.observe(document.createElement("div"), null, listener);
  listener.mockClear();
  visibility.dispose();
  vi.runAllTimers();
  expect(listener).not.toHaveBeenCalled();
});

it("shares three observers per root and releases the last registration", () => {
  const intersections = installThumbnailIntersections();
  const visibility = new ThumbnailVisibility();
  const root = document.createElement("main");
  const otherRoot = document.createElement("main");
  const releases = Array.from({ length: 10 }, () =>
    visibility.observe(document.createElement("div"), root, vi.fn()),
  );
  expect(intersections.count()).toBe(3);
  expect(intersections.targets()).toBe(30);
  const releaseOther = visibility.observe(document.createElement("div"), otherRoot, vi.fn());
  expect(intersections.count()).toBe(6);
  releases.forEach((release) => release());
  expect(intersections.count()).toBe(3);
  expect(intersections.targets()).toBe(3);
  releaseOther();
  expect(intersections.count()).toBe(0);
  visibility.dispose();
});

it("updates visible priority when a prefetched card enters the viewport", () => {
  const intersections = installThumbnailIntersections();
  const visibility = new ThumbnailVisibility();
  const root = document.createElement("main");
  const card = document.createElement("div");
  let top = 900;
  vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 800, 600));
  vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, top, 200, 200));
  const listener = vi.fn();
  const release = visibility.observe(card, root, listener);
  expect(listener).toHaveBeenLastCalledWith({
    shouldLoad: true,
    shouldKeep: true,
    priority: "prefetch",
  });
  top = 100;
  intersections.sync();
  expect(listener).toHaveBeenLastCalledWith({
    shouldLoad: true,
    shouldKeep: true,
    priority: "visible",
  });
  release();
  visibility.dispose();
});

it("trusts the observer for a card the layout has not measured yet", () => {
  const visibility = new ThumbnailVisibility();
  const listener = vi.fn();
  const release = visibility.observe(document.createElement("div"), null, listener);
  expect(listener).toHaveBeenNthCalledWith(1, {
    shouldLoad: false,
    shouldKeep: false,
    priority: "hidden",
  });
  expect(listener).toHaveBeenLastCalledWith({
    shouldLoad: true,
    shouldKeep: true,
    priority: "visible",
  });
  release();
  visibility.dispose();
});

it("ignores repeat syncs that leave the zones unchanged", async () => {
  const visibility = new ThumbnailVisibility();
  const root = document.createElement("main");
  const card = document.createElement("div");
  vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 800, 600));
  vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 100, 200, 200));
  const listener = vi.fn();
  const release = visibility.observe(card, root, listener);
  expect(listener).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(listener).toHaveBeenCalledTimes(1);
  release();
  visibility.dispose();
});

it("keeps a rebuilt observer group when a stale release fires", () => {
  const intersections = installThumbnailIntersections();
  const visibility = new ThumbnailVisibility();
  const root = document.createElement("main");
  const release = visibility.observe(document.createElement("div"), root, vi.fn());
  release();
  expect(intersections.count()).toBe(0);
  visibility.observe(document.createElement("div"), root, vi.fn());
  expect(intersections.count()).toBe(3);
  release();
  visibility.dispose();
  expect(intersections.count()).toBe(0);
});
