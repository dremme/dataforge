import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as folderApi from "@/features/folder/api/folderContents";
import { folderKeys, folderQueryOptions } from "@/features/folder/lib/folderQuery";
import * as preferences from "@/features/folder/lib/folderPreferences";
import * as instructionsApi from "@/shared/api/folderInstructions";
import type { FolderInstructionsResponse } from "@/shared/types";
import { homeFolder } from "@/test/fixtures";
import { queryWrapper } from "@/test/queryClient";
import { useFolderInstructions } from "./useFolderInstructions";

function instructions(sysprompt: string): FolderInstructionsResponse {
  const file = (text: string) => ({
    text,
    has_file: false,
    parent_folder: "C:\\",
    parent_relative_path: "..",
    parent_text: text,
    locked_by_job_id: null,
  });
  return { sysprompt: file(sysprompt), caption_rules: file(""), caption_rules_template: "" };
}

describe("useFolderInstructions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads again when a full re-read of the folder brings a new fingerprint", async () => {
    // A parent's prompt changing moves the fingerprint, and only ever as a full listing.
    const fetchInstructions = vi
      .spyOn(instructionsApi, "fetchFolderInstructions")
      .mockResolvedValueOnce(instructions("Describe the scene."))
      .mockResolvedValueOnce(instructions("Describe the morning light."));
    vi.spyOn(folderApi, "fetchFolderChanges").mockResolvedValue({
      full: true,
      fingerprint: "fp-v2",
      changed: [],
      removed: [],
      stale_subfolders: [],
    });
    vi.spyOn(preferences, "loadFolderContents").mockResolvedValue({
      ...homeFolder,
      fingerprint: "fp-v2",
    });
    const { client, wrapper } = queryWrapper();
    client.setQueryData(folderKeys.folder(homeFolder.path), {
      ...homeFolder,
      fingerprint: "fp-v1",
    });

    const { result } = renderHook(() => useFolderInstructions(homeFolder.path), { wrapper });
    await waitFor(() =>
      expect(result.current.instructions?.sysprompt.text).toBe("Describe the scene."),
    );

    await client.fetchQuery({ ...folderQueryOptions(homeFolder.path), staleTime: 0 });

    await waitFor(() =>
      expect(result.current.instructions?.sysprompt.text).toBe("Describe the morning light."),
    );
    expect(fetchInstructions).toHaveBeenCalledTimes(2);
  });
});
