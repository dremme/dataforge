import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "@/shared/api/http";
import { createTestQueryClient } from "@/test/queryClient";
import {
  emptyAutomationSettings,
  loadAutomationSettings as loadWith,
} from "./automationPreferences";
import type { putJson } from "@/shared/api/http";

vi.mock("@/shared/api/http", () => ({
  requestJson: vi.fn<typeof requestJson>(),
  putJson: vi.fn<typeof putJson>(),
}));

const request = vi.mocked(requestJson);

const FOLDER = "C:\\Photos";

/** A fresh client per read, as an opening dialog would have; no retries for the offline case. */
const loadAutomationSettings = (folderPath: string) =>
  loadWith(folderPath, createTestQueryClient({ retry: false }));

function respondWith(overrides: Record<string, unknown>) {
  request.mockResolvedValue({ folder_path: FOLDER, ...overrides });
}

describe("loadAutomationSettings", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("asks for this folder's settings once", async () => {
    respondWith({});

    await loadAutomationSettings(FOLDER);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      `/api/preferences/automation?path=${encodeURIComponent(FOLDER)}`,
    );
  });

  it("maps every job's block", async () => {
    respondWith({
      auto_caption: {
        mode: "instruct",
        reasoning_effort: "xhigh",
        preserve_thinking: false,
        caption_audio: true,
      },
      set_captions: { caption: "A mountain lake." },
      replace_captions: {
        mode: "append",
        search: "lake",
        replacement: "river",
        use_regex: true,
        case_sensitive: true,
      },
      verify_captions: {
        mode: "thinking",
        reasoning_effort: "low",
        preserve_thinking: false,
        context: "Studio shots.",
      },
      edit_captions: {
        mode: "thinking",
        reasoning_effort: "xhigh",
        preserve_thinking: false,
        instruction: "Rewrite in present tense.",
      },
      batch_rename: { stem: "shot", start_number: 7 },
      find_duplicates: { threshold: "loose" },
      train_lora: { trigger_word: "mtnstyle", prompts: ["a lake"], model: "h3_fl2va" },
      watermark: {
        text: "Sample Studio",
        size: "large",
        opacity: 75,
        position: "top_left",
        strip_metadata: true,
      },
      resize: { megapixels: 1.5, multiple: 8 },
    });

    const settings = await loadAutomationSettings(FOLDER);

    expect(settings.auto_caption).toEqual({
      mode: "instruct",
      reasoning_effort: "xhigh",
      preserve_thinking: false,
      caption_audio: true,
    });
    expect(settings.set_captions).toEqual({ caption: "A mountain lake." });
    expect(settings.replace_captions.mode).toBe("append");
    expect(settings.verify_captions.context).toBe("Studio shots.");
    expect(settings.edit_captions).toEqual({
      mode: "thinking",
      reasoning_effort: "xhigh",
      preserve_thinking: false,
      instruction: "Rewrite in present tense.",
    });
    expect(settings.batch_rename).toEqual({ stem: "shot", start_number: 7 });
    expect(settings.find_duplicates).toEqual({ threshold: "loose" });
    expect(settings.train_lora).toEqual({
      trigger_word: "mtnstyle",
      prompts: ["a lake"],
      model: "h3_fl2va",
    });
    expect(settings.watermark).toEqual({
      text: "Sample Studio",
      size: "large",
      opacity: 75,
      position: "top_left",
      strip_metadata: true,
    });
    expect(settings.resize).toEqual({ megapixels: 1.5, multiple: 8 });
  });

  it("resolves to the defaults instead of rejecting when preferences are unreachable", async () => {
    // A preferences outage must not stop the user from starting a job.
    request.mockRejectedValue(new Error("offline"));

    await expect(loadAutomationSettings(FOLDER)).resolves.toEqual(emptyAutomationSettings(FOLDER));
  });

  it("never writes: settings are stored by starting the job", async () => {
    const { putJson } = await import("@/shared/api/http");
    respondWith({});

    await loadAutomationSettings(FOLDER);

    expect(putJson).not.toHaveBeenCalled();
  });

  it("never touches Web Storage", async () => {
    // Uncached on purpose: job settings change per run/folder/tab, so a local copy would be stale.
    const storages = [localStorage, sessionStorage];
    const spies = storages.flatMap((storage) => [
      vi.spyOn(storage, "getItem"),
      vi.spyOn(storage, "setItem"),
      vi.spyOn(storage, "removeItem"),
    ]);
    respondWith({ watermark: { text: "Sample Studio" } });

    await loadAutomationSettings(FOLDER);
    await loadAutomationSettings(FOLDER);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("re-reads the backend on every call rather than serving a memoised answer", async () => {
    respondWith({ find_duplicates: { threshold: "loose" } });
    expect((await loadAutomationSettings(FOLDER)).find_duplicates.threshold).toBe("loose");

    // A job started elsewhere moved the fallback on; the next open must see it.
    respondWith({ find_duplicates: { threshold: "exact" } });

    expect((await loadAutomationSettings(FOLDER)).find_duplicates.threshold).toBe("exact");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
