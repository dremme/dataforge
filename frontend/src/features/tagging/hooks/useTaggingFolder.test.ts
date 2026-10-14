import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import type { TaggingStatusResponse } from "@/shared/types";
import { installFakeEventSource } from "@/test/fakeEventSource";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { queryWrapper } from "@/test/queryClient";
import { useTaggingFolder } from "./useTaggingFolder";

function status(overrides: Partial<TaggingStatusResponse> = {}): TaggingStatusResponse {
  return {
    state: "idle",
    detail: "",
    model: "yolov8x-worldv2.pt",
    vocabulary_size: 280,
    pending: 0,
    folder: null,
    ...overrides,
  };
}

function renderTaggingFolder() {
  const { client, wrapper: Queries } = queryWrapper();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Queries, null, createElement(ServerEventsProvider, null, children));
  return { client, ...renderHook(() => useTaggingFolder(), { wrapper }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTaggingFolder", () => {
  it("names the folder the tagger is working on", async () => {
    installFakeEventSource();
    installMockBackend({ taggingStatus: status({ state: "tagging", folder: HOME_PATH }) });

    const { result } = renderTaggingFolder();

    await waitFor(() => expect(result.current).toBe(HOME_PATH));
  });

  it("names none while the tagger is idle, even with a stale folder", async () => {
    installFakeEventSource();
    const backend = installMockBackend({
      taggingStatus: status({ state: "idle", folder: HOME_PATH }),
    });

    const { result } = renderTaggingFolder();

    await waitFor(() => expect(backend.requestsTo("/api/system/tagging", "GET")).toHaveLength(1));
    expect(result.current).toBeNull();
  });

  it("follows the pushed status from folder to folder and back to idle", async () => {
    const stream = installFakeEventSource();
    const backend = installMockBackend({
      taggingStatus: status({ state: "tagging", folder: HOME_PATH }),
    });
    const { client, result } = renderTaggingFolder();
    await waitFor(() => expect(result.current).toBe(HOME_PATH));
    // Connecting re-reads the status; let that settle so it cannot land after the push.
    stream.open();
    await waitFor(() => expect(backend.requestsTo("/api/system/tagging", "GET")).toHaveLength(2));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    act(() =>
      stream.push({
        type: "tagging",
        status: status({ state: "tagging", folder: VACATION_PATH }),
      }),
    );
    await waitFor(() => expect(result.current).toBe(VACATION_PATH));

    act(() => stream.push({ type: "tagging", status: status() }));
    await waitFor(() => expect(result.current).toBeNull());
  });
});
