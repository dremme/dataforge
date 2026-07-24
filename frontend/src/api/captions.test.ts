import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("./http", () => ({
  requestJson: requestJsonMock,
}));

import {
  fetchCaption,
  fetchComfyWorkflow,
  saveCaption,
  saveCaptionJson,
  saveSysPrompt,
} from "./captions";

const jsonHeaders = { "Content-Type": "application/json" };

describe("captions API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
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
    requestJsonMock.mockResolvedValue({ description: "Updated." });

    await saveCaption("C:\\Photos\\sunset.png", "Updated.");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/caption?path=C%3A%5CPhotos%5Csunset.png", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "Updated." }),
    });
  });

  it("includes bboxes when saving a caption", async () => {
    requestJsonMock.mockResolvedValue({ description: "Updated." });
    const bboxes = [{ x1: 1, y1: 2, x2: 3, y2: 4, label: "Sign" }];

    await saveCaption("C:\\Photos\\sunset.png", "Updated.", bboxes);

    expect(requestJsonMock).toHaveBeenCalledWith("/api/caption?path=C%3A%5CPhotos%5Csunset.png", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "Updated.", bboxes }),
    });
  });

  it("saves raw JSON caption content", async () => {
    requestJsonMock.mockResolvedValue({ description: "Updated." });

    await saveCaptionJson("C:\\Photos\\sunset.png", '{"description":"Updated."}');

    expect(requestJsonMock).toHaveBeenCalledWith("/api/caption?path=C%3A%5CPhotos%5Csunset.png", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ json_content: '{"description":"Updated."}' }),
    });
  });

  it("saves a system prompt", async () => {
    requestJsonMock.mockResolvedValue({ description: "Prompt." });

    await saveSysPrompt("C:\\Photos", "Prompt.");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/sysprompt?path=C%3A%5CPhotos", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "Prompt." }),
    });
  });
});
