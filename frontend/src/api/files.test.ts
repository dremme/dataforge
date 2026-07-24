import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("./http", () => ({
  requestJson: requestJsonMock,
}));

import { importFiles, previewFileImport } from "./files";

describe("files API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("previews import conflicts", async () => {
    requestJsonMock.mockResolvedValue({
      importable: ["a.png"],
      new_files: [],
      conflicts: ["a.png"],
      rejected: [],
    });

    await previewFileImport("C:\\Photos", ["a.png"]);

    expect(requestJsonMock).toHaveBeenCalledWith("/api/files/import/preview?path=C%3A%5CPhotos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filenames: ["a.png"] }),
    });
  });

  it("uploads files with overwrite flag", async () => {
    requestJsonMock.mockResolvedValue({ copied: ["a.png"], skipped: [], rejected: [] });
    const file = new File(["bytes"], "a.png", { type: "image/png" });

    await importFiles("C:\\Photos", [file], true);

    const [url, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/files/import?path=C%3A%5CPhotos&overwrite=true");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });
});
