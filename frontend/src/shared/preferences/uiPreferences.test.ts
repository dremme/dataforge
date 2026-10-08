import { focusManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, queryWrapper } from "@/test/queryClient";
import {
  THEME_CACHE_KEY,
  updateUiSettings,
  useUiSettings,
  useUpdateUiSettings,
} from "./uiPreferences";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const serverCopy = {
  sort: "name-asc",
  show_automation_specs: true,
  theme: "dark",
  keep_candidate_metadata: false,
  jobs_drawer_filters: { job_types: ["watermark"], status: "failed", folder: "all" },
};

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useUiSettings", () => {
  it("paints the local copy first, then takes the server's and mirrors it", async () => {
    localStorage.setItem(THEME_CACHE_KEY, "light");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(serverCopy)));

    const { result } = renderHook(() => useUiSettings(), { wrapper: queryWrapper().wrapper });

    expect(result.current.theme).toBe("light");
    await waitFor(() =>
      expect(result.current).toEqual({
        sort: "name-asc",
        showAutomationSpecs: true,
        theme: "dark",
        keepCandidateMetadata: false,
        jobsDrawerFilters: { jobTypes: ["watermark"], status: "failed", folder: "all" },
      }),
    );
    expect(localStorage.getItem("gallery-sort")).toBe("name-asc");
    expect(localStorage.getItem("automation-specs-visible")).toBe("true");
    expect(localStorage.getItem("keep-candidate-metadata")).toBe("false");
  });

  it("keeps candidate metadata until it is turned off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { wrapper } = queryWrapper(createTestQueryClient({ retry: false }));

    const { result } = renderHook(() => useUiSettings(), { wrapper });

    expect(result.current.keepCandidateMetadata).toBe(true);
  });

  it("keeps the local copy when the backend cannot be reached", async () => {
    localStorage.setItem(THEME_CACHE_KEY, "light");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = queryWrapper(createTestQueryClient({ retry: false }));

    const { result } = renderHook(() => useUiSettings(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.theme).toBe("light");
  });

  it("shares one request between readers that start together", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(serverCopy));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = queryWrapper();

    const first = renderHook(() => useUiSettings(), { wrapper });
    const second = renderHook(() => useUiSettings(), { wrapper });

    await waitFor(() => expect(second.result.current.sort).toBe("name-asc"));
    expect(first.result.current).toBe(second.result.current);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useUpdateUiSettings", () => {
  it("applies a change at once and saves it", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init?: RequestInit) =>
        respond(init?.method === "PUT" ? { ...serverCopy, sort: "date-desc" } : serverCopy),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => ({ settings: useUiSettings(), update: useUpdateUiSettings() }),
      { wrapper: queryWrapper().wrapper },
    );
    await waitFor(() => expect(result.current.settings.sort).toBe("name-asc"));

    act(() => result.current.update({ sort: "date-desc" }));

    await waitFor(() => expect(result.current.settings.sort).toBe("date-desc"));
    expect(localStorage.getItem("gallery-sort")).toBe("date-desc");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preferences/ui",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ sort: "date-desc" }) }),
    );
  });
});

it("keeps later choices visible while preference writes finish in order", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const writes = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? writes(init) : Promise.resolve(respond(serverCopy)),
    ),
  );
  const { wrapper } = queryWrapper();
  const reader = renderHook(() => useUiSettings(), { wrapper });
  const one = renderHook(() => useUpdateUiSettings(), { wrapper });
  const two = renderHook(() => useUpdateUiSettings(), { wrapper });
  await waitFor(() => expect(reader.result.current.sort).toBe("name-asc"));
  act(() => one.result.current({ sort: "date-desc" }));
  await waitFor(() => expect(writes).toHaveBeenCalledTimes(1));
  act(() => two.result.current({ sort: "name-desc", showAutomationSpecs: false }));
  await waitFor(() => expect(reader.result.current.sort).toBe("name-desc"));
  const writesBeforeFirstReply = writes.mock.calls.length;
  await act(async () => first.resolve(respond({ ...serverCopy, sort: "date-desc" })));
  await waitFor(() => expect(writes).toHaveBeenCalledTimes(2));
  const stateAfterFirstReply = reader.result.current;
  const mirroredAfterFirstReply = localStorage.getItem("gallery-sort");
  await act(async () =>
    second.resolve(
      respond({
        ...serverCopy,
        sort: "name-desc",
        show_automation_specs: false,
      }),
    ),
  );
  expect(writesBeforeFirstReply).toBe(1);
  expect(stateAfterFirstReply.sort).toBe("name-desc");
  expect(stateAfterFirstReply.showAutomationSpecs).toBe(false);
  expect(mirroredAfterFirstReply).toBe("name-desc");
  expect(reader.result.current.sort).toBe("name-desc");
});

it("shares fresh preferences across remounts and refreshes an expired copy", async () => {
  const fetchMock = vi.fn().mockResolvedValue(respond(serverCopy));
  vi.stubGlobal("fetch", fetchMock);
  const { wrapper } = queryWrapper();
  const first = renderHook(() => useUiSettings(), { wrapper });
  await waitFor(() => expect(first.result.current.sort).toBe("name-asc"));
  first.unmount();
  const second = renderHook(() => useUiSettings(), { wrapper });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  second.unmount();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
  fetchMock.mockImplementation(() =>
    Promise.resolve(respond({ ...serverCopy, sort: "date-desc" })),
  );
  const third = renderHook(() => useUiSettings(), { wrapper });
  await waitFor(() => expect(third.result.current.sort).toBe("date-desc"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("continues queued writes after a failure, including theme saves outside React", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubGlobal("fetch", fetchMock);
  const failed = updateUiSettings({ sort: "date-desc" }).catch((error: unknown) => error);
  const later = updateUiSettings({ theme: "light", sort: "name-desc" });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem("gallery-sort")).toBe("name-desc");
  first.reject(new TypeError("Failed to fetch"));
  await failed;
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  second.resolve(respond({ ...serverCopy, sort: "name-desc", theme: "light" }));
  await expect(later).resolves.toMatchObject({ theme: "light", sort: "name-desc" });
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/preferences/ui",
    expect.objectContaining({
      body: JSON.stringify({ sort: "name-desc", theme: "light" }),
    }),
  );
});
