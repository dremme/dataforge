import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installThumbnailImages } from "@/test/thumbnailImages";
import { installThumbnailIntersections } from "@/test/thumbnailIntersections";
import type { ThumbnailDemand } from "@/features/gallery/lib/thumbnailStore";
import { ThumbnailProvider } from "./ThumbnailProvider";
import { useThumbnailRuntime } from "./thumbnailContext";

const frame: ThumbnailDemand = {
  url: "/thumbnail?path=frame.jpg&v=1",
  fallbackUrl: "/media?path=frame.jpg&v=1",
  priority: "visible",
  recover: true,
};
const lake: ThumbnailDemand = { ...frame, url: "/thumbnail?path=lake.jpg&v=1" };
let loads: ReturnType<typeof installThumbnailImages>;

beforeEach(() => {
  loads = installThumbnailImages();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("requires a provider above every consumer", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Orphan() {
    useThumbnailRuntime();
    return null;
  }
  expect(() => render(<Orphan />)).toThrow("ThumbnailProvider is required");
});

it("releases in-flight loads, retry timers and observers when it unmounts", () => {
  vi.useFakeTimers();
  const intersections = installThumbnailIntersections();
  let runtime: ReturnType<typeof useThumbnailRuntime> | undefined;
  function Probe() {
    runtime = useThumbnailRuntime();
    return <div />;
  }
  const { container, unmount } = render(
    <ThumbnailProvider>
      <Probe />
    </ThumbnailProvider>,
  );
  const { store, visibility } = runtime!;
  visibility.observe(container.querySelector("div")!, null, vi.fn());
  store.setDemand({}, [frame]);
  loads.fail();
  loads.fail();
  store.setDemand({}, [lake]);
  // The store's retry timer, plus the pending layout frame the visibility module queued.
  expect(vi.getTimerCount()).toBe(2);
  expect(intersections.count()).toBe(3);
  expect(loads.images.at(-1)?.onload).not.toBeNull();

  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(intersections.count()).toBe(0);
  expect(loads.images.every((image) => image.onload === null)).toBe(true);
  expect(store.getSnapshot(frame.url).status).toBe("idle");
});
