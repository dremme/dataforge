import { afterEach, describe, expect, it, vi } from "vitest";
import type { BodyPartsSettings } from "../bodyPartsPreferences";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("./http", () => ({
  requestJson: requestJsonMock,
}));

import {
  startAutoCaptionJob,
  startBatchRenameJob,
  startBodyPartsJob,
  startSetCaptionsJob,
  startStripMetadataJob,
  startVerifyCaptionsJob,
} from "./automation";

const jsonHeaders = { "Content-Type": "application/json" };

const bodyPartsSettings: BodyPartsSettings = {
  bodyDescription: "torso",
  faceDescription: "face",
  keywords: "bag",
  elementDescription: "accessory",
};

describe("automation API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("starts an auto-caption job", async () => {
    requestJsonMock.mockResolvedValue({ id: "job-1", status: "queued" });

    await startAutoCaptionJob("C:\\Photos", "instruct");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/automation/auto-caption?path=C%3A%5CPhotos",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ mode: "instruct" }),
      },
    );
  });

  it("starts a body-parts job", async () => {
    requestJsonMock.mockResolvedValue({ id: "job-2", status: "queued" });

    await startBodyPartsJob("C:\\Photos", bodyPartsSettings);

    expect(requestJsonMock).toHaveBeenCalledWith("/api/automation/body-parts?path=C%3A%5CPhotos", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        body_description: "torso",
        face_description: "face",
        keywords: "bag",
        element_description: "accessory",
      }),
    });
  });

  it("starts a set-captions job", async () => {
    requestJsonMock.mockResolvedValue({ id: "job-3", status: "queued" });

    await startSetCaptionsJob("C:\\Photos", "Shared caption", true);

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/automation/set-captions?path=C%3A%5CPhotos",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ caption: "Shared caption", overwrite: true }),
      },
    );
  });

  it("starts a verify-captions job", async () => {
    requestJsonMock.mockResolvedValue({
      id: "job-5",
      status: "queued",
      job_type: "verify_captions",
    });

    await startVerifyCaptionsJob("C:\\Photos", "thinking", "Outdoor portraits.");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/automation/verify-captions?path=C%3A%5CPhotos",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ mode: "thinking", context: "Outdoor portraits." }),
      },
    );
  });

  it("includes selected paths when starting a scoped job", async () => {
    requestJsonMock.mockResolvedValue({ id: "job-6", status: "queued" });

    await startStripMetadataJob("C:\\Photos", ["C:\\Photos\\one.png", "C:\\Photos\\two.png"]);

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/automation/strip-metadata?path=C%3A%5CPhotos",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          paths: ["C:\\Photos\\one.png", "C:\\Photos\\two.png"],
        }),
      },
    );
  });

  it("starts a batch-rename job", async () => {
    requestJsonMock.mockResolvedValue({ id: "job-7", status: "queued", job_type: "batch_rename" });

    await startBatchRenameJob("C:\\Photos", "portugal");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/automation/batch-rename?path=C%3A%5CPhotos",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ stem: "portugal" }),
      },
    );
  });

  it("starts a strip-metadata job", async () => {
    requestJsonMock.mockResolvedValue({ id: "job-4", status: "queued" });

    await startStripMetadataJob("C:\\Photos");

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/automation/strip-metadata?path=C%3A%5CPhotos",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({}),
      },
    );
  });
});
