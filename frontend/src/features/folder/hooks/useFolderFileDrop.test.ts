import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/files";
import type { FileImportPreviewResponse } from "@/shared/types";
import { useFolderFileDrop } from "./useFolderFileDrop";

const FOLDER_A = "/datasets/a";
const FOLDER_B = "/datasets/b";

function dropOf(files: File[]): DragEvent {
  return {
    preventDefault: () => {},
    dataTransfer: { types: ["Files"], files, dropEffect: "none" },
  } as unknown as DragEvent;
}

function conflictPreview(names: string[]): FileImportPreviewResponse {
  return { importable: names, new_files: [], conflicts: names, rejected: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderDrop(folderPath: string) {
  return renderHook(
    ({ path }) => useFolderFileDrop({ folderPath: path, enabled: true, onImported: () => {} }),
    { initialProps: { path: folderPath } },
  );
}

const photo = () => new File(["pixels"], "photo.png", { type: "image/png" });

describe("useFolderFileDrop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops a preview that resolves after the folder changed", async () => {
    const preview = deferred<FileImportPreviewResponse>();
    vi.spyOn(api, "previewFileImport").mockReturnValue(preview.promise);
    const importFiles = vi.spyOn(api, "importFiles");
    const view = renderDrop(FOLDER_A);

    act(() => view.result.current.onDrop(dropOf([photo()])));
    view.rerender({ path: FOLDER_B });
    await act(async () => preview.resolve(conflictPreview(["photo.png"])));

    expect(view.result.current.overwritePrompt).toBeNull();
    act(() => view.result.current.confirmOverwrite());
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("closes an open overwrite prompt when the folder changes", async () => {
    vi.spyOn(api, "previewFileImport").mockResolvedValue(conflictPreview(["photo.png"]));
    const importFiles = vi.spyOn(api, "importFiles");
    const view = renderDrop(FOLDER_A);

    await act(async () => view.result.current.onDrop(dropOf([photo()])));
    expect(view.result.current.overwritePrompt).not.toBeNull();

    view.rerender({ path: FOLDER_B });
    expect(view.result.current.overwritePrompt).toBeNull();
    act(() => view.result.current.confirmOverwrite());
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("imports into the folder the prompt was raised for", async () => {
    vi.spyOn(api, "previewFileImport").mockResolvedValue(conflictPreview(["photo.png"]));
    const importFiles = vi
      .spyOn(api, "importFiles")
      .mockResolvedValue({ copied: [], skipped: [], rejected: [] });
    const view = renderDrop(FOLDER_A);

    await act(async () => view.result.current.onDrop(dropOf([photo()])));
    await act(async () => view.result.current.confirmOverwrite());

    expect(importFiles).toHaveBeenCalledTimes(1);
    expect(importFiles).toHaveBeenCalledWith(FOLDER_A, expect.any(Array), true);
  });

  it("sends one import when confirm is pressed twice", async () => {
    vi.spyOn(api, "previewFileImport").mockResolvedValue(conflictPreview(["photo.png"]));
    const pending = deferred<Awaited<ReturnType<typeof api.importFiles>>>();
    const importFiles = vi.spyOn(api, "importFiles").mockReturnValue(pending.promise);
    const view = renderDrop(FOLDER_A);

    await act(async () => view.result.current.onDrop(dropOf([photo()])));
    act(() => {
      view.result.current.confirmOverwrite();
      view.result.current.confirmOverwrite();
    });
    await act(async () => pending.resolve({ copied: [], skipped: [], rejected: [] }));

    expect(importFiles).toHaveBeenCalledTimes(1);
  });
});
