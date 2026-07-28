import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCachedVisionModelId,
  loadVisionModelId,
  resetVisionModelIdCacheForTests,
} from "./visionLlm";

const requestJsonMock = vi.fn();

vi.mock("@/shared/api/http", () => ({
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
}));

describe("visionLlm", () => {
  afterEach(() => {
    resetVisionModelIdCacheForTests();
    requestJsonMock.mockReset();
  });

  it("fetches the model id once and reuses the cache", async () => {
    requestJsonMock.mockResolvedValue({ model: "qwen35" });

    await expect(loadVisionModelId()).resolves.toBe("qwen35");
    await expect(loadVisionModelId()).resolves.toBe("qwen35");

    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    expect(requestJsonMock).toHaveBeenCalledWith("/api/system/vision-llm");
    expect(getCachedVisionModelId()).toBe("qwen35");
  });

  it("dedupes concurrent loads", async () => {
    let resolveRequest: (value: { model: string }) => void = () => undefined;
    requestJsonMock.mockReturnValue(
      new Promise<{ model: string }>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = loadVisionModelId();
    const second = loadVisionModelId();
    resolveRequest({ model: "gemma-4" });

    await expect(Promise.all([first, second])).resolves.toEqual(["gemma-4", "gemma-4"]);
    expect(requestJsonMock).toHaveBeenCalledTimes(1);
  });
});
