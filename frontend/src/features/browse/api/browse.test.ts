import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
}));

import { fetchBrowse, fetchBrowseFingerprint } from "./browse";

describe("browse API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("fetches the default browse response without a path", async () => {
    requestJsonMock.mockResolvedValue({ folder: "C:\\Photos", images: [] });

    await fetchBrowse();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/browse");
  });

  it("fetches a specific folder", async () => {
    requestJsonMock.mockResolvedValue({ folder: "C:\\Photos", images: [] });

    await fetchBrowse("C:\\Photos\\Vacation");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/browse?path=C%3A%5CPhotos%5CVacation");
  });

  it("fetches a browse fingerprint", async () => {
    requestJsonMock.mockResolvedValue({ fingerprint: "abc123" });

    await fetchBrowseFingerprint("C:\\Photos");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/browse/fingerprint?path=C%3A%5CPhotos");
  });
});
