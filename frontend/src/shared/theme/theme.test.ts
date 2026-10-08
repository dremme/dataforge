import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithQueryClient } from "@/test/queryClient";
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

function respond(theme: string) {
  const body = {
    sort: "name-asc",
    show_automation_specs: false,
    theme,
    jobs_drawer_filters: { job_types: [], status: "all", folder: "all" },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** The server's copy of the UI settings, answered when the test says so. */
function holdServerTheme() {
  let answer: (theme: string) => void = () => {};
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return respond(JSON.parse(init.body as string).theme);
    return new Promise<Response>((resolve) => {
      answer = (theme) => resolve(respond(theme));
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, answer: (theme: string) => answer(theme) };
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
    const server = holdServerTheme();

    renderHookWithQueryClient(() => useThemeSync());
    await act(async () => server.answer("system"));

    await waitFor(() => expect(getThemePreference()).toBe("system"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => system.change(true));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("takes a choice made in another tab", () => {
    stubSystemScheme(false);
    holdServerTheme();
    const { result } = renderHookWithQueryClient(() => {
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
    const server = holdServerTheme();
    renderHookWithQueryClient(() => useThemeSync());

    act(() => setThemePreference("dark"));
    await act(async () => server.answer("light"));

    expect(getThemePreference()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ui-theme")).toBe("dark");
    await waitFor(() =>
      expect(server.fetchMock).toHaveBeenCalledWith(
        "/api/preferences/ui",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ theme: "dark" }) }),
      ),
    );
  });
});
