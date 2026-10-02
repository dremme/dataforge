import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVisionModelId } from "./visionLlm";

const requestJsonMock = vi.fn();

vi.mock("@/shared/api/http", () => ({
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
}));

describe("fetchVisionModelId", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("reads the configured model id", async () => {
    requestJsonMock.mockResolvedValue({ model: "qwen38" });

    await expect(fetchVisionModelId()).resolves.toBe("qwen38");
    expect(requestJsonMock).toHaveBeenCalledWith("/api/system/vision-llm");
  });

  it("answers an empty id when the backend names no model", async () => {
    requestJsonMock.mockResolvedValue({ model: null });

    await expect(fetchVisionModelId()).resolves.toBe("");
  });
});
