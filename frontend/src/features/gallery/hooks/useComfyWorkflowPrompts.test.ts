import { focusManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import type { ComfyWorkflowPromptsResponse } from "@/shared/types";
import { queryWrapper } from "@/test/queryClient";
import { useComfyWorkflowPrompts } from "./useComfyWorkflowPrompts";

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
});

it("parses once while open and reads changed file metadata when reopened", async () => {
  const initial: ComfyWorkflowPromptsResponse = {
    has_workflow: true,
    branches: [],
    matched_node_id: null,
    orphan_prompts: [],
    has_editor_workflow: false,
    matched_by_size: false,
  };
  const changed = { ...initial, has_workflow: false };
  const fetchMock = vi.spyOn(api, "fetchComfyWorkflowPrompts").mockResolvedValue(initial);
  const { client, wrapper } = queryWrapper();
  const first = renderHook(() => useComfyWorkflowPrompts("C:/Photos/image.png", true), { wrapper });
  await waitFor(() => expect(first.result.current.data).toEqual(initial));
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  first.unmount();
  await waitFor(() =>
    expect(client.getQueryData(["comfy-workflow-prompts", "C:/Photos/image.png"])).toBeUndefined(),
  );
  fetchMock.mockResolvedValue(changed);
  const second = renderHook(() => useComfyWorkflowPrompts("C:/Photos/image.png", true), {
    wrapper,
  });
  expect(second.result.current.loading).toBe(true);
  await waitFor(() => expect(second.result.current.data).toEqual(changed));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
