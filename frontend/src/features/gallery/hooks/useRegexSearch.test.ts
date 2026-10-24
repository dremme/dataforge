import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REGEX_SEARCH_BUDGET_MS, useRegexSearch } from "./useRegexSearch";
import { matchRegexTexts } from "@/features/gallery/lib/regexSearch";
import type { RegexSearchRequest } from "@/features/gallery/lib/regexSearch.worker";

/** Stands in for the browser's worker; `answer` replies the way the real one would. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  requests: RegexSearchRequest[] = [];
  terminated = false;
  private listeners: ((event: MessageEvent) => void)[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.push(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners = this.listeners.filter((entry) => entry !== listener);
  }

  postMessage(request: RegexSearchRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  answer() {
    const request = this.requests.at(-1)!;
    const data = { id: request.id, matches: matchRegexTexts(request.pattern, request.texts) };
    for (const listener of this.listeners) listener({ data } as MessageEvent);
  }
}

const TEXTS = ["a dog", "a cat", "dog.png"];

describe("useRegexSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers from the worker", () => {
    const { result } = renderHook(() => useRegexSearch("dog", TEXTS));
    expect(result.current.status).toBe("pending");

    act(() => FakeWorker.instances[0].answer());

    expect(result.current).toEqual({ status: "ready", matches: new Set(["a dog", "dog.png"]) });
  });

  it("gives up on a pattern that runs past its budget, and stops the worker", () => {
    const { result } = renderHook(() => useRegexSearch("^(a|aa)+$", TEXTS));

    act(() => vi.advanceTimersByTime(REGEX_SEARCH_BUDGET_MS));

    expect(result.current).toEqual({ status: "too-expensive", matches: new Set() });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("does not queue a new pattern behind one still running", () => {
    const { result, rerender } = renderHook(({ pattern }) => useRegexSearch(pattern, TEXTS), {
      initialProps: { pattern: "^(a|aa)+$" },
    });

    rerender({ pattern: "cat" });

    expect(FakeWorker.instances[0].terminated).toBe(true);
    act(() => FakeWorker.instances[1].answer());
    expect(result.current).toEqual({ status: "ready", matches: new Set(["a cat"]) });
  });

  it("keeps the last answer while the next one is worked out", () => {
    const { result, rerender } = renderHook(({ pattern }) => useRegexSearch(pattern, TEXTS), {
      initialProps: { pattern: "dog" },
    });
    act(() => FakeWorker.instances[0].answer());

    rerender({ pattern: "cat" });

    expect(result.current).toEqual({ status: "pending", matches: new Set(["a dog", "dog.png"]) });
  });

  it("is idle without a pattern", () => {
    const { result } = renderHook(() => useRegexSearch(null, TEXTS));

    expect(result.current).toEqual({ status: "idle" });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
