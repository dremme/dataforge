import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installThumbnailImages } from "@/test/thumbnailImages";
import { ThumbnailStore } from "./thumbnailStore";
import type { ThumbnailDemand } from "./thumbnailStore";

const frame: ThumbnailDemand = {
  url: "/thumbnail?path=frame.jpg&v=1",
  fallbackUrl: "/media?path=frame.jpg&v=1",
  priority: "visible",
  recover: true,
};
let store: ThumbnailStore;
let loads: ReturnType<typeof installThumbnailImages>;

beforeEach(() => {
  vi.useFakeTimers();
  store = new ThumbnailStore();
  loads = installThumbnailImages();
});
afterEach(() => {
  store.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("thumbnail demand", () => {
  it("keeps shared requests alive until the last consumer releases them", () => {
    const card = {};
    const gallery = {};
    store.setDemand(card, [frame]);
    store.setDemand(gallery, [frame]);
    expect(loads.images).toHaveLength(1);
    store.setDemand(gallery, []);
    expect(loads.images[0].getAttribute("src")).toBe(frame.url);
    loads.load();
    expect(store.getSnapshot(frame.url)).toEqual({ status: "ready", src: frame.url });
  });

  it("resumes the latest screenshots after a modal pause", () => {
    const owner = {};
    store.setPaused(true);
    store.setDemand(owner, [{ ...frame, url: "/old.jpg" }]);
    store.setDemand(owner, [frame]);
    expect(loads.images).toHaveLength(0);
    store.setPaused(false);
    expect(loads.images).toHaveLength(1);
    expect(loads.images[0].getAttribute("src")).toBe(frame.url);
  });

  it("lets active loads finish while paused without starting queued work", () => {
    store.setDemand(
      {},
      Array.from({ length: 25 }, (_, i) => ({ ...frame, url: `/frame-${i}.jpg` })),
    );
    expect(loads.images).toHaveLength(24);
    store.setPaused(true);
    loads.load(0);
    expect(loads.images).toHaveLength(24);
    store.setPaused(false);
    expect(loads.images).toHaveLength(25);
  });

  it("prioritizes visible cards and preserves deferred prefetch across scrolling", () => {
    const prefetch = {};
    store.setDemand(
      prefetch,
      Array.from({ length: 24 }, (_, i) => ({
        ...frame,
        url: `/near-${i}.jpg`,
        priority: "prefetch",
        recover: false,
      })),
    );
    store.setDemand({}, [frame]);
    expect(loads.images).toHaveLength(25);
    expect(loads.images.at(-1)?.getAttribute("src")).toBe(frame.url);
    store.setScrolling(true);
    expect(loads.images.slice(0, 24).every((image) => !image.hasAttribute("src"))).toBe(true);
    store.setScrolling(false);
    expect(loads.images.length).toBeGreaterThan(25);
  });

  it("limits new requests to eight while scrolling", () => {
    store.setScrolling(true);
    store.setDemand(
      {},
      Array.from({ length: 12 }, (_, i) => ({ ...frame, url: `/frame-${i}.jpg` })),
    );
    expect(loads.images).toHaveLength(8);
    loads.load(0);
    expect(loads.images).toHaveLength(9);
  });

  it("ignores cancelled attempts even after the same URL is requested again", () => {
    const owner = {};
    store.setDemand(owner, [frame]);
    const image = loads.images[0];
    const complete = image.onload!;
    store.setDemand(owner, []);
    store.setDemand(owner, [frame]);
    complete.call(image, new Event("load"));
    expect(store.getSnapshot(frame.url).status).toBe("loading");
    loads.load();
    expect(store.getSnapshot(frame.url).status).toBe("ready");
  });

  it("never lets an older revision complete the current resource", () => {
    const owner = {};
    store.setDemand(owner, [frame]);
    const image = loads.images[0];
    const complete = image.onload!;
    const newer = { ...frame, url: "/thumbnail?path=frame.jpg&v=2" };
    store.setDemand(owner, [newer]);
    complete.call(image, new Event("load"));
    expect(store.getSnapshot(newer.url).status).toBe("loading");
    loads.load();
    expect(store.getSnapshot(newer.url).src).toBe(newer.url);
  });

  it("notifies subscribers until they detach, and finishes the load regardless", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(frame.url, listener);
    store.setDemand({}, [frame]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot(frame.url).status).toBe("loading");
    unsubscribe();
    loads.load();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot(frame.url)).toEqual({ status: "ready", src: frame.url });
  });

  it("serves a remounted card from cache without asking for it again", () => {
    const first = {};
    store.setDemand(first, [frame]);
    loads.load();
    store.setDemand(first, []);
    const listener = vi.fn();
    store.subscribe(frame.url, listener);
    store.setDemand({}, [frame]);
    expect(loads.images).toHaveLength(1);
    expect(store.getSnapshot(frame.url)).toEqual({ status: "ready", src: frame.url });
    expect(listener).not.toHaveBeenCalled();
  });

  it("merges the strongest priority and recovery across consumers", () => {
    const prefetch = {};
    const card = {};
    store.setDemand(card, [frame]);
    store.setDemand(prefetch, [{ ...frame, priority: "prefetch", recover: false }]);
    store.setScrolling(true);
    expect(loads.images).toHaveLength(1);
    expect(loads.images[0].getAttribute("src")).toBe(frame.url);
    store.setScrolling(false);
    loads.fail();
    expect(loads.images.at(-1)?.getAttribute("src")).toBe(frame.fallbackUrl);
    store.setDemand(card, []);
    expect(loads.images[1].hasAttribute("src")).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(loads.images).toHaveLength(2);
  });

  it("frees every concurrency slot whether a load completes, fails or is dropped", () => {
    const owner = {};
    const batch = (prefix: string) =>
      Array.from({ length: 24 }, (_, i) => ({ ...frame, url: `/${prefix}-${i}.jpg` }));
    store.setDemand(owner, batch("first"));
    expect(loads.images).toHaveLength(24);
    loads.load(0);
    loads.fail(1);
    const churned = loads.images.length;
    store.setDemand(owner, []);
    store.setDemand(owner, batch("second"));
    expect(loads.images).toHaveLength(churned + 24);
  });

  it("reuses ready URLs and evicts old unreferenced resources at 500 entries", () => {
    const owner = {};
    for (let i = 0; i < 501; i++) {
      store.setDemand(owner, [{ ...frame, url: `/frame-${i}.jpg` }]);
      loads.load();
    }
    store.setDemand(owner, []);
    expect(store.getSnapshot("/frame-0.jpg").status).toBe("idle");
    store.setDemand(owner, [{ ...frame, url: "/frame-500.jpg" }]);
    expect(loads.images).toHaveLength(501);
  });
});

describe("thumbnail recovery", () => {
  it("falls back for images, then retries the thumbnail at bounded delays", () => {
    store.setDemand({}, [frame]);
    loads.fail();
    expect(loads.images.at(-1)?.getAttribute("src")).toBe(frame.fallbackUrl);
    for (const [index, delay] of [1000, 2000, 4000, 8000].entries()) {
      loads.fail();
      const count = loads.images.length;
      vi.advanceTimersByTime(delay - 1);
      expect(loads.images).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(loads.images.at(-1)?.getAttribute("src")).toBe(`${frame.url}&retry=${index + 1}`);
      loads.fail();
      expect(loads.images.at(-1)?.getAttribute("src")).toBe(frame.fallbackUrl);
    }
    loads.fail();
    const count = loads.images.length;
    vi.advanceTimersByTime(60000);
    expect(loads.images).toHaveLength(count);
    expect(store.getSnapshot(frame.url).status).toBe("failed");
  });

  it("never uses full video files as image fallbacks", () => {
    store.setDemand({}, [{ ...frame, fallbackUrl: undefined }]);
    loads.fail();
    expect(loads.images).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(loads.images[1].getAttribute("src")).toBe(`${frame.url}&retry=1`);
  });

  it("waits for card demand before recovering a failed speculative request", () => {
    const owner = {};
    store.setDemand(owner, [{ ...frame, priority: "prefetch", recover: false }]);
    loads.fail();
    vi.advanceTimersByTime(60000);
    expect(loads.images).toHaveLength(1);
    store.setDemand({}, [frame]);
    expect(loads.images.at(-1)?.getAttribute("src")).toBe(frame.fallbackUrl);
  });

  it.each(["pause", "retain"])(
    "suspends retries during %s without consuming attempts",
    (reason) => {
      const owner = {};
      const video = { ...frame, fallbackUrl: undefined };
      store.setDemand(owner, [video]);
      loads.fail();
      if (reason === "pause") store.setPaused(true);
      else store.setDemand(owner, [{ ...video, priority: "retain", recover: false }]);
      vi.advanceTimersByTime(60000);
      expect(loads.images).toHaveLength(1);
      store.setPaused(false);
      store.setDemand(owner, [video]);
      expect(loads.images.at(-1)?.getAttribute("src")).toBe(`${frame.url}&retry=1`);
    },
  );

  it("invalidates a ready source when the rendered image fails", () => {
    store.setDemand({}, [frame]);
    loads.load();
    const ready = store.getSnapshot(frame.url);
    store.reportError(frame.url, ready);
    expect(loads.images.at(-1)?.getAttribute("src")).toBe(frame.fallbackUrl);
    store.reportError(frame.url, ready);
    expect(loads.images).toHaveLength(2);
  });

  it("gives a recovered thumbnail a fresh retry budget", () => {
    const video = { ...frame, fallbackUrl: undefined };
    store.setDemand({}, [video]);
    loads.fail();
    vi.advanceTimersByTime(1000);
    loads.fail();
    vi.advanceTimersByTime(2000);
    expect(loads.images.at(-1)?.getAttribute("src")).toBe(`${frame.url}&retry=2`);
    loads.load();
    store.reportError(video.url, store.getSnapshot(video.url));
    vi.advanceTimersByTime(1000);
    expect(loads.images.at(-1)?.getAttribute("src")).toBe(`${frame.url}&retry=1`);
  });

  it("comes back from disposal as a fresh store", () => {
    store.setPaused(true);
    store.setDemand({}, [frame]);
    expect(loads.images).toHaveLength(0);
    store.dispose();
    store.setDemand({}, [frame]);
    expect(loads.images).toHaveLength(1);
  });

  it("releases callbacks, listeners and retry timers on disposal", () => {
    const listener = vi.fn();
    store.subscribe(frame.url, listener);
    store.setDemand({}, [frame]);
    loads.fail();
    loads.fail();
    store.dispose();
    const calls = listener.mock.calls.length;
    vi.advanceTimersByTime(60000);
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getSnapshot(frame.url).status).toBe("idle");
  });
});
