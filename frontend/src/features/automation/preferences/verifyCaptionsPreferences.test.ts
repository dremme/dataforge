import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyVerifyCaptionsSettings,
  loadVerifyCaptionsSettings,
  updateVerifyCaptionsSettings,
} from "./verifyCaptionsPreferences";

const requestJsonMock = vi.fn();
const putJsonMock = vi.fn();

vi.mock("@/shared/api/http", () => ({
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
  putJson: (...args: unknown[]) => putJsonMock(...args),
}));

vi.mock("@/shared/lib/retry", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

describe("verifyCaptionsPreferences", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
    putJsonMock.mockReset();
  });

  it("loads settings for a folder from the backend", async () => {
    requestJsonMock.mockResolvedValue({
      mode: "thinking",
      context: "Travel notes.",
      folder_path: "C:\\Photos\\Trip",
    });

    const settings = await loadVerifyCaptionsSettings("C:\\Photos\\Trip");

    expect(requestJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/preferences/verify-captions?"),
    );
    expect(settings).toEqual({
      mode: "thinking",
      context: "Travel notes.",
      folderPath: "C:\\Photos\\Trip",
    });
  });

  it("persists settings to the backend with folder_path", async () => {
    putJsonMock.mockResolvedValue({
      mode: "instruct",
      context: "Saved context.",
      folder_path: "C:\\Photos\\A",
    });

    const settings = await updateVerifyCaptionsSettings("C:\\Photos\\A", {
      mode: "instruct",
      context: "Saved context.",
    });

    expect(putJsonMock).toHaveBeenCalledWith("/api/preferences/verify-captions", {
      mode: "instruct",
      context: "Saved context.",
      folder_path: "C:\\Photos\\A",
    });
    expect(settings.context).toBe("Saved context.");
  });

  it("returns empty defaults when the backend is unreachable", async () => {
    requestJsonMock.mockRejectedValue(new Error("offline"));

    const settings = await loadVerifyCaptionsSettings("C:\\Photos\\A");

    expect(settings).toEqual(emptyVerifyCaptionsSettings("C:\\Photos\\A"));
  });
});
