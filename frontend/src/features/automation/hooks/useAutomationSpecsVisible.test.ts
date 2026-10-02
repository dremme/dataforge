import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithQueryClient } from "@/test/queryClient";
import { useAutomationSpecsVisible } from "./useAutomationSpecsVisible";

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubSettings(showAutomationSpecs: boolean) {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const saved = init?.body ? JSON.parse(init.body as string) : {};
    return respond({
      sort: "name-asc",
      theme: "system",
      show_automation_specs: saved.show_automation_specs ?? showAutomationSpecs,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useAutomationSpecsVisible", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the saved preference from ui settings", async () => {
    stubSettings(true);

    const { result } = renderHookWithQueryClient(() => useAutomationSpecsVisible());

    await waitFor(() => expect(result.current.showSpecs).toBe(true));
  });

  it("persists when toggled", async () => {
    const fetchMock = stubSettings(false);

    const { result } = renderHookWithQueryClient(() => useAutomationSpecsVisible());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => result.current.toggleSpecs());

    await waitFor(() => expect(result.current.showSpecs).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preferences/ui",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ show_automation_specs: true }),
      }),
    );
  });
});
