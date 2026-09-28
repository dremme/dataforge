import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as uiPreferences from "@/shared/preferences/uiPreferences";
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
  useThemePreference,
  useThemeSync,
} from "./theme";

function stubSystemScheme(light: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: light,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    change(nextLight: boolean) {
      media.matches = nextLight;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("resolves System from the OS scheme", () => {
    stubSystemScheme(true);
    expect(resolveTheme("system")).toBe("light");

    stubSystemScheme(false);
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("adopts the server's choice on start and follows the OS while on System", async () => {
    const system = stubSystemScheme(false);
    vi.spyOn(uiPreferences, "loadUiSettings").mockResolvedValue({
      sort: "name-asc",
      showAutomationSpecs: false,
      theme: "system",
    });

    renderHook(() => useThemeSync());

    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => system.change(true));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("takes a choice made in another tab", () => {
    stubSystemScheme(false);
    vi.spyOn(uiPreferences, "loadUiSettings").mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => {
      useThemeSync();
      return useThemePreference();
    });

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "ui-theme", newValue: "light" }));
    });

    expect(result.current).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("a choice made here is applied, cached, persisted, and outranks a late server answer", async () => {
    stubSystemScheme(false);
    let answer: (settings: uiPreferences.UiSettings) => void = () => {};
    vi.spyOn(uiPreferences, "loadUiSettings").mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const update = vi.spyOn(uiPreferences, "updateUiSettings").mockResolvedValue({
      sort: "name-asc",
      showAutomationSpecs: false,
      theme: "dark",
    });
    renderHook(() => useThemeSync());

    act(() => setThemePreference("dark"));
    await act(async () => answer({ sort: "name-asc", showAutomationSpecs: false, theme: "light" }));

    expect(getThemePreference()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ui-theme")).toBe("dark");
    await waitFor(() => expect(update).toHaveBeenCalledWith({ theme: "dark" }));
  });
});
