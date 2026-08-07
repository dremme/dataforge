import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock, putJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
  putJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
  putJson: putJsonMock,
}));

vi.mock("@/shared/lib/retry", () => ({
  withRetry: (run: () => Promise<unknown>) => run(),
}));

import { loadWatermarkSettings, updateWatermarkSettings } from "./watermarkPreferences";

describe("watermarkPreferences", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
    putJsonMock.mockReset();
  });

  it("reads the stored settings", async () => {
    requestJsonMock.mockResolvedValue({
      text: "Sample Studio",
      size: "large",
      opacity: 75,
      position: "top",
    });

    await expect(loadWatermarkSettings()).resolves.toEqual({
      text: "Sample Studio",
      size: "large",
      opacity: 75,
      position: "top",
    });
    expect(requestJsonMock).toHaveBeenCalledWith("/api/preferences/watermark");
  });

  it("falls back to the defaults instead of rejecting", async () => {
    requestJsonMock.mockRejectedValue(new Error("offline"));

    // A preferences outage must not stop the user from opening the dialog.
    await expect(loadWatermarkSettings()).resolves.toEqual({
      text: "",
      size: "medium",
      opacity: 50,
      position: "bottom",
    });
  });

  it("replaces a value the backend no longer recognises", async () => {
    requestJsonMock.mockResolvedValue({
      text: "Sample Studio",
      size: "huge",
      opacity: 33,
      position: "side",
    });

    await expect(loadWatermarkSettings()).resolves.toEqual({
      text: "Sample Studio",
      size: "medium",
      opacity: 50,
      position: "bottom",
    });
  });

  it("writes a partial update", async () => {
    putJsonMock.mockResolvedValue({
      text: "Sample Studio",
      size: "medium",
      opacity: 50,
      position: "bottom",
    });

    await updateWatermarkSettings({ text: "Sample Studio" });

    expect(putJsonMock).toHaveBeenCalledWith("/api/preferences/watermark", {
      text: "Sample Studio",
    });
  });
});
