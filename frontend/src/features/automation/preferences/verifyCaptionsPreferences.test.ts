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
      reasoning_effort: "xhigh",
      preserve_thinking: false,
      context: "Travel notes.",
      folder_path: "C:\\Photos\\Trip",
    });

    const settings = await loadVerifyCaptionsSettings("C:\\Photos\\Trip");

    expect(requestJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/preferences/verify-captions?"),
    );
    expect(settings).toEqual({
      mode: "thinking",
      reasoningEffort: "xhigh",
      preserveThinking: false,
      context: "Travel notes.",
      folderPath: "C:\\Photos\\Trip",
    });
  });

  it("replaces a reasoning effort the backend no longer recognises", async () => {
    requestJsonMock.mockResolvedValue({
      mode: "instruct",
      reasoning_effort: "high",
      context: "",
      folder_path: "C:\\Photos\\A",
    });

    const settings = await loadVerifyCaptionsSettings("C:\\Photos\\A");

    expect(settings.reasoningEffort).toBe("medium");
    expect(settings.preserveThinking).toBe(true);
  });

  it("persists settings to the backend with folder_path", async () => {
    putJsonMock.mockResolvedValue({
      mode: "instruct",
      reasoning_effort: "low",
      preserve_thinking: true,
      context: "Saved context.",
      folder_path: "C:\\Photos\\A",
    });

    const settings = await updateVerifyCaptionsSettings("C:\\Photos\\A", {
      mode: "instruct",
      context: "Saved context.",
      reasoningEffort: "low",
      preserveThinking: true,
    });

    expect(putJsonMock).toHaveBeenCalledWith("/api/preferences/verify-captions", {
      mode: "instruct",
      reasoning_effort: "low",
      preserve_thinking: true,
      context: "Saved context.",
      folder_path: "C:\\Photos\\A",
    });
    expect(settings.context).toBe("Saved context.");
    expect(settings.reasoningEffort).toBe("low");
  });

  it("returns empty defaults when the backend is unreachable", async () => {
    requestJsonMock.mockRejectedValue(new Error("offline"));

    const settings = await loadVerifyCaptionsSettings("C:\\Photos\\A");

    expect(settings).toEqual(emptyVerifyCaptionsSettings("C:\\Photos\\A"));
  });
});
