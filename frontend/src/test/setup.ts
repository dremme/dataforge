import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("@uiw/react-codemirror", async () => {
  const { MockCodeMirror } = await import("./mockCodeMirror");
  return { default: MockCodeMirror };
});

vi.mock("@/shared/lib/codeEditorTheme", () => ({
  getCodeEditorHighlightExtension: () => [],
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: () => [],
}));

vi.mock("@codemirror/lang-json", () => ({
  json: () => [],
}));

vi.mock("@codemirror/view", () => ({
  EditorView: {
    lineWrapping: {},
    contentAttributes: { of: () => [] },
    editorAttributes: { of: () => [] },
    editable: { of: () => [] },
    domEventHandlers: () => [],
  },
  Decoration: {
    mark: () => ({}),
  },
  ViewPlugin: {
    fromClass: () => [],
  },
}));

vi.mock("@codemirror/state", () => ({
  RangeSetBuilder: class {
    add() {}
    finish() {
      return {};
    }
  },
}));

vi.mock("@codemirror/search", () => ({
  search: () => [],
}));

function createVirtualizerMock(options: { count: number }) {
  return {
    getTotalSize: () => 340 * options.count,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        key: index,
        index,
        start: index * 340,
      })),
    measureElement: () => {},
    measure: () => {},
    options: { scrollMargin: 0 },
  };
}

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => createVirtualizerMock(options),
  useWindowVirtualizer: (options: { count: number }) => createVirtualizerMock(options),
}));

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

Object.defineProperty(window, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
});

Object.defineProperty(window, "sessionStorage", {
  value: new MemoryStorage(),
  writable: true,
});

const clipboardMock = {
  writeText: vi.fn<typeof navigator.clipboard.writeText>().mockResolvedValue(undefined),
};

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: clipboardMock,
});

Object.defineProperty(window, "scrollY", { value: 0, writable: true });
window.scrollTo = vi.fn();

// jsdom does not implement HTMLMediaElement.load and logs noisy "Not implemented" errors
// when modal video prefetch runs during gallery tests.
Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  writable: true,
  value: function load(this: HTMLMediaElement) {},
});

// jsdom implements no EventSource, and `renderWithProviders` mounts the real
// `ServerEventsProvider` so components can subscribe to push the way they do in the app.
// A test that wants to deliver frames re-stubs this through `installFakeEventSource`.
class InertEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;

  close(): void {}
}

Object.defineProperty(window, "EventSource", {
  value: InertEventSource,
  writable: true,
  // `installFakeEventSource` stubs over this, which a non-configurable property refuses.
  configurable: true,
});

// jsdom performs no layout, so every element measures zero. The gallery's
// default mode lays its columns out from the container's width and renders
// nothing without one, so divs get a plausible width to measure. A test that
// cares about a specific width re-stubs this on the same prototype.
Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return 1000;
  },
});

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, "ResizeObserver", {
  value: ResizeObserverMock,
  writable: true,
});

class IntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds: readonly number[] = [0];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element): void {
    this.callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], this);
  }

  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, "IntersectionObserver", {
  value: IntersectionObserverMock,
  writable: true,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clipboardMock.writeText = vi
    .fn<typeof navigator.clipboard.writeText>()
    .mockResolvedValue(undefined);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
