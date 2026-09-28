import { afterEach, describe, expect, it, vi } from "vitest";
import { loadUiSettings, THEME_CACHE_KEY } from "./uiPreferences";

vi.mock("@/shared/lib/retry", () => ({
  withRetry: <T>(attempt: () => Promise<T>) => attempt(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadUiSettings", () => {
  it("keeps the cached theme when the backend cannot be reached", async () => {
    localStorage.setItem(THEME_CACHE_KEY, "light");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect((await loadUiSettings()).theme).toBe("light");
  });

  it("shares one request between readers that start together", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ sort: "name-asc", show_automation_specs: false, theme: "dark" }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([loadUiSettings(), loadUiSettings()]);

    expect(first.theme).toBe("dark");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
