import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderScrollIntent } from "./useFolderNavigation";
import { useFolderScrollPosition } from "./useFolderScrollPosition";

const HOME_PATH = "C:\\Users\\dev\\Photos";
const VACATION_PATH = "C:\\Users\\dev\\Photos\\Vacation";

/** jsdom has no layout, so `.main` needs a writable `scrollTop` to observe. */
function mountScrollElement(initialScrollTop = 0): HTMLElement {
  const element = document.createElement("main");
  element.className = "main";
  Object.defineProperty(element, "scrollTop", {
    value: initialScrollTop,
    writable: true,
    configurable: true,
  });
  document.body.appendChild(element);
  return element;
}

function intentOf(overrides: Partial<FolderScrollIntent> & Pick<FolderScrollIntent, "id">) {
  return {
    mode: "reset",
    path: HOME_PATH,
    target: 0,
    ...overrides,
  } satisfies FolderScrollIntent;
}

describe("useFolderScrollPosition", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("leaves the scroll alone while the destination is still loading", () => {
    const element = mountScrollElement(900);

    renderHook(() =>
      useFolderScrollPosition({
        intent: intentOf({ id: 1, path: VACATION_PATH }),
        folderPath: VACATION_PATH,
        loading: true,
        hasError: false,
      }),
    );

    expect(element.scrollTop).toBe(900);
  });

  it("resets to the top once the destination has painted", () => {
    const element = mountScrollElement(900);

    const { rerender } = renderHook(useFolderScrollPosition, {
      initialProps: {
        intent: null,
        folderPath: HOME_PATH,
        loading: false,
        hasError: false,
      } as Parameters<typeof useFolderScrollPosition>[0],
    });

    rerender({
      intent: intentOf({ id: 1, path: VACATION_PATH }),
      folderPath: VACATION_PATH,
      loading: true,
      hasError: false,
    });
    expect(element.scrollTop).toBe(900);

    rerender({
      intent: intentOf({ id: 1, path: VACATION_PATH }),
      folderPath: VACATION_PATH,
      loading: false,
      hasError: false,
    });
    expect(element.scrollTop).toBe(0);
  });

  it("restores the remembered offset for a matching folder", () => {
    const element = mountScrollElement(0);

    renderHook(() =>
      useFolderScrollPosition({
        intent: intentOf({ id: 1, mode: "restore", path: HOME_PATH, target: 940 }),
        folderPath: "C:/Users/dev/Photos/",
        loading: false,
        hasError: false,
      }),
    );

    expect(element.scrollTop).toBe(940);
  });

  it("falls back to the top when the folder that loaded is not the one requested", () => {
    const element = mountScrollElement(400);

    renderHook(() =>
      useFolderScrollPosition({
        intent: intentOf({ id: 1, mode: "restore", path: VACATION_PATH, target: 940 }),
        folderPath: HOME_PATH,
        loading: false,
        hasError: false,
      }),
    );

    expect(element.scrollTop).toBe(0);
  });

  it("falls back to the top when the destination failed to load", () => {
    const element = mountScrollElement(400);

    renderHook(() =>
      useFolderScrollPosition({
        intent: intentOf({ id: 1, mode: "restore", path: HOME_PATH, target: 940 }),
        folderPath: HOME_PATH,
        loading: false,
        hasError: true,
      }),
    );

    expect(element.scrollTop).toBe(0);
  });

  it("does not re-apply when the folder object churns without a new intent", () => {
    const element = mountScrollElement(900);

    const { rerender } = renderHook(useFolderScrollPosition, {
      initialProps: {
        intent: null,
        folderPath: HOME_PATH,
        loading: false,
        hasError: false,
      } as Parameters<typeof useFolderScrollPosition>[0],
    });

    const intent = intentOf({ id: 1, mode: "restore", path: HOME_PATH, target: 500 });
    rerender({ intent, folderPath: HOME_PATH, loading: false, hasError: false });
    expect(element.scrollTop).toBe(500);

    // A silent reload: the user has scrolled on since, and nothing may move them.
    element.scrollTop = 620;
    rerender({ intent, folderPath: HOME_PATH, loading: false, hasError: false });
    rerender({ intent, folderPath: "C:/Users/dev/Photos", loading: false, hasError: false });

    expect(element.scrollTop).toBe(620);
  });

  it("lets a newer intent take over from the previous one", () => {
    const element = mountScrollElement(900);

    const { rerender } = renderHook(useFolderScrollPosition, {
      initialProps: {
        intent: null,
        folderPath: HOME_PATH,
        loading: false,
        hasError: false,
      } as Parameters<typeof useFolderScrollPosition>[0],
    });

    rerender({
      intent: intentOf({ id: 1, mode: "restore", path: HOME_PATH, target: 500 }),
      folderPath: HOME_PATH,
      loading: false,
      hasError: false,
    });
    expect(element.scrollTop).toBe(500);

    rerender({
      intent: intentOf({ id: 2, path: VACATION_PATH }),
      folderPath: VACATION_PATH,
      loading: false,
      hasError: false,
    });
    expect(element.scrollTop).toBe(0);
  });
});
