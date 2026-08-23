import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock, putJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
  putJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
  putJson: putJsonMock,
}));

import { fetchCaption, fetchComfyWorkflow, saveCaption, saveSysPrompt } from "./captions";

describe("captions API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
    putJsonMock.mockReset();
  });

  it("fetches a caption", async () => {
    requestJsonMock.mockResolvedValue({ description: "A scene." });

    await fetchCaption("C:\\Photos\\sunset.png");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/caption?path=C%3A%5CPhotos%5Csunset.png");
  });

  it("fetches comfy workflow metadata", async () => {
    requestJsonMock.mockResolvedValue({ has_workflow: true });

    await fetchComfyWorkflow("C:\\Photos\\sunset.png");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/comfy-workflow?path=C%3A%5CPhotos%5Csunset.png",
    );
  });

  it("saves a text caption", async () => {
    putJsonMock.mockResolvedValue({ description: "Updated." });

    await saveCaption("C:\\Photos\\sunset.png", "Updated.");

    expect(putJsonMock).toHaveBeenCalledWith("/api/caption?path=C%3A%5CPhotos%5Csunset.png", {
      text: "Updated.",
    });
  });

  it("saves a system prompt", async () => {
    putJsonMock.mockResolvedValue({ description: "Prompt." });

    await saveSysPrompt("C:\\Photos", "Prompt.");

    expect(putJsonMock).toHaveBeenCalledWith("/api/sysprompt?path=C%3A%5CPhotos", {
      text: "Prompt.",
    });
  });
});
