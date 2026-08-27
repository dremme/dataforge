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

vi.mock("@codemirror/lang-yaml", () => ({
  yaml: () => [],
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

// jsdom logs "Not implemented" for HTMLMediaElement.load during video prefetch.
Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  writable: true,
  value: function load(this: HTMLMediaElement) {},
});

// jsdom has no EventSource; tests that deliver frames remock via installFakeEventSource.
class InertEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;

  close(): void {}
}

Object.defineProperty(window, "EventSource", {
  value: InertEventSource,
  writable: true,
  configurable: true,
});

// jsdom has no layout; gallery masonry needs a measured width.
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
