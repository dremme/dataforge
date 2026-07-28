import { afterEach, describe, expect, it, vi } from "vitest";
import type { BodyPartsSettings } from "@/features/automation/preferences/bodyPartsPreferences";

const { postJsonMock } = vi.hoisted(() => ({
  postJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  postJson: postJsonMock,
}));

import {
  startAutoCaptionJob,
  startBatchRenameJob,
  startBodyPartsJob,
  startSetCaptionsJob,
  startStripMetadataJob,
  startVerifyCaptionsJob,
} from "./jobs";

const bodyPartsSettings: BodyPartsSettings = {
  bodyDescription: "torso",
  faceDescription: "face",
  keywords: "bag",
  elementDescription: "accessory",
};

describe("automation API", () => {
  afterEach(() => {
    postJsonMock.mockReset();
  });

  it("starts an auto-caption job", async () => {
    postJsonMock.mockResolvedValue({ id: "job-1", status: "queued" });

    await startAutoCaptionJob("C:\\Photos", "instruct");

    expect(postJsonMock).toHaveBeenCalledWith("/api/automation/auto-caption?path=C%3A%5CPhotos", {
      mode: "instruct",
    });
  });

  it("starts a body-parts job", async () => {
    postJsonMock.mockResolvedValue({ id: "job-2", status: "queued" });

    await startBodyPartsJob("C:\\Photos", bodyPartsSettings);

    expect(postJsonMock).toHaveBeenCalledWith("/api/automation/body-parts?path=C%3A%5CPhotos", {
      body_description: "torso",
      face_description: "face",
      keywords: "bag",
      element_description: "accessory",
    });
  });

  it("starts a set-captions job", async () => {
    postJsonMock.mockResolvedValue({ id: "job-3", status: "queued" });

    await startSetCaptionsJob("C:\\Photos", "Shared caption", true);

    expect(postJsonMock).toHaveBeenCalledWith("/api/automation/set-captions?path=C%3A%5CPhotos", {
      caption: "Shared caption",
      overwrite: true,
    });
  });

  it("starts a verify-captions job", async () => {
    postJsonMock.mockResolvedValue({
      id: "job-5",
      status: "queued",
      job_type: "verify_captions",
    });

    await startVerifyCaptionsJob("C:\\Photos", "thinking", "Outdoor portraits.");

    expect(postJsonMock).toHaveBeenCalledWith(
      "/api/automation/verify-captions?path=C%3A%5CPhotos",
      {
        mode: "thinking",
        context: "Outdoor portraits.",
      },
    );
  });

  it("includes selected paths when starting a scoped job", async () => {
    postJsonMock.mockResolvedValue({ id: "job-6", status: "queued" });

    await startStripMetadataJob("C:\\Photos", ["C:\\Photos\\one.png", "C:\\Photos\\two.png"]);

    expect(postJsonMock).toHaveBeenCalledWith("/api/automation/strip-metadata?path=C%3A%5CPhotos", {
      paths: ["C:\\Photos\\one.png", "C:\\Photos\\two.png"],
    });
  });

  it("starts a batch-rename job", async () => {
    postJsonMock.mockResolvedValue({ id: "job-7", status: "queued", job_type: "batch_rename" });

    await startBatchRenameJob("C:\\Photos", "portugal");

    expect(postJsonMock).toHaveBeenCalledWith("/api/automation/batch-rename?path=C%3A%5CPhotos", {
      stem: "portugal",
    });
  });

  it("starts a strip-metadata job", async () => {
    postJsonMock.mockResolvedValue({ id: "job-4", status: "queued" });

    await startStripMetadataJob("C:\\Photos");

    expect(postJsonMock).toHaveBeenCalledWith(
      "/api/automation/strip-metadata?path=C%3A%5CPhotos",
      {},
    );
  });
});
