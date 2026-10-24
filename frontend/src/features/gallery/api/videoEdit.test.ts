import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyVideoEdit,
  cancelVideoEdit,
  fetchVideoAutoAdjust,
  fetchVideoEditState,
  revertVideoEdit,
  transcodeVideo,
  videoOriginalUrl,
} from "./videoEdit";
import { requestJson } from "@/shared/api/http";
import { serverEventsTabId } from "@/shared/api/eventStream";
import type { VideoEditSpec } from "@/shared/types";
import { RESTING_ADJUST } from "@/features/gallery/lib/colorAdjust";
import type { postJson } from "@/shared/api/http";

vi.mock("@/shared/api/http", () => ({
  requestJson: vi.fn<typeof requestJson>(),
  postJson: vi.fn<typeof postJson>(),
}));

const requestJsonMock = vi.mocked(requestJson);
const CLIP = "C:\\Photos\\clip.mp4";
const ENCODED = "C%3A%5CPhotos%5Cclip.mp4";

const SPEC: VideoEditSpec = {
  masks: [],
  trim_start: 1,
  trim_end: 4,
  crop: null,
  speed: 2,
  scale: 0.5,
  volume: 1,
  transcode: false,
  adjust: { ...RESTING_ADJUST },
};

beforeEach(() => {
  requestJsonMock.mockReset();
  requestJsonMock.mockResolvedValue({});
});

describe("videoOriginalUrl", () => {
  it("asks for the stored original rather than the current bytes", () => {
    expect(videoOriginalUrl(CLIP)).toBe(`/api/media?path=${ENCODED}&original=1`);
  });

  it("keeps the cache token, since the original changes when the file does", () => {
    expect(videoOriginalUrl(CLIP, "17-42")).toBe(`/api/media?path=${ENCODED}&v=17-42&original=1`);
  });
});

describe("fetchVideoEditState", () => {
  it("reads the stored spec for one file", async () => {
    await fetchVideoEditState(CLIP);

    expect(requestJsonMock).toHaveBeenCalledWith(`/api/media/video-edit?path=${ENCODED}`);
  });
});

describe("applyVideoEdit", () => {
  it("posts the spec as JSON", async () => {
    await applyVideoEdit(CLIP, SPEC);

    const [url, init] = requestJsonMock.mock.calls[0];
    expect(url).toContain(`/api/media/video-edit?path=${ENCODED}`);
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual(SPEC);
  });

  it("addresses the progress frames to this tab", async () => {
    await applyVideoEdit(CLIP, SPEC);

    const [url] = requestJsonMock.mock.calls[0];
    expect(url).toContain(`tab=${encodeURIComponent(serverEventsTabId())}`);
  });
});

describe("transcodeVideo", () => {
  it("re-renders the file's current edit with the transcode flag set", async () => {
    requestJsonMock
      .mockResolvedValueOnce({ path: CLIP, has_backup: true, spec: SPEC, frame_rate: 25 })
      .mockResolvedValueOnce({});

    await transcodeVideo(CLIP);

    const [, init] = requestJsonMock.mock.calls[1];
    expect(JSON.parse(String(init?.body))).toEqual({ ...SPEC, transcode: true });
  });

  it("transcodes an unedited file from an empty spec", async () => {
    requestJsonMock
      .mockResolvedValueOnce({ path: CLIP, has_backup: false, spec: null, frame_rate: 25 })
      .mockResolvedValueOnce({});

    await transcodeVideo(CLIP);

    const [, init] = requestJsonMock.mock.calls[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      trim_start: 0,
      trim_end: null,
      transcode: true,
    });
  });
});

describe("fetchVideoAutoAdjust", () => {
  it("posts the draft so the wand reads only the kept range, and addresses no tab", async () => {
    await fetchVideoAutoAdjust(CLIP, SPEC);

    const [url, init] = requestJsonMock.mock.calls[0];
    expect(url).toBe(`/api/media/video-edit/auto?path=${ENCODED}`);
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toEqual(SPEC);
  });
});

describe("revertVideoEdit", () => {
  it("posts to the revert endpoint", async () => {
    await revertVideoEdit(CLIP);

    expect(requestJsonMock).toHaveBeenCalledWith(`/api/media/video-edit/revert?path=${ENCODED}`, {
      method: "POST",
    });
  });
});

describe("cancelVideoEdit", () => {
  it("posts to the cancel endpoint without waiting on a body", async () => {
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await cancelVideoEdit(CLIP);

    expect(fetchMock).toHaveBeenCalledWith(`/api/media/video-edit/cancel?path=${ENCODED}`, {
      method: "POST",
    });
  });
});
