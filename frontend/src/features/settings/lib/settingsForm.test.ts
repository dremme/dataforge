import { describe, expect, it } from "vitest";
import { appSettings } from "@/test/fixtures";
import {
  buildSettingsUpdate,
  draftFromSettings,
  editDraftValue,
  editedSettingKeys,
  resetDraftValue,
} from "./settingsForm";

const saved = appSettings({
  comfy_base_url: {
    value: "http://127.0.0.1:9100",
    source: "saved",
    fallback: "http://gpu-box:8188",
    fallback_source: "env",
  },
});

describe("settings form", () => {
  it("starts unedited and sends nothing", () => {
    const draft = draftFromSettings(saved);

    expect(editedSettingKeys(saved, draft)).toEqual([]);
    expect(buildSettingsUpdate(saved, draft)).toEqual({ update: {} });
  });

  it("sends only the values that changed, typed for the wire", () => {
    let draft = draftFromSettings(saved);
    draft = editDraftValue(draft, "vision_model", " model-b ");
    draft = editDraftValue(draft, "vision_timeout_seconds", "90.5");
    draft = editDraftValue(draft, "thumbnail_cache_max_mb", "0");

    expect(buildSettingsUpdate(saved, draft)).toEqual({
      update: { vision_model: "model-b", vision_timeout_seconds: 90.5, thumbnail_cache_max_mb: 0 },
    });
  });

  it("an edit back to the saved value is no edit at all", () => {
    let draft = editDraftValue(draftFromSettings(saved), "vision_model", "other");
    draft = editDraftValue(draft, "vision_model", "qwen38");

    expect(editedSettingKeys(saved, draft)).toEqual([]);
  });

  it("a reset shows the fallback and sends the key to reset", () => {
    const draft = resetDraftValue(draftFromSettings(saved), saved, "comfy_base_url");

    expect(draft.values.comfy_base_url).toBe("http://gpu-box:8188");
    expect(editedSettingKeys(saved, draft)).toEqual(["comfy_base_url"]);
    expect(buildSettingsUpdate(saved, draft)).toEqual({ update: { reset: ["comfy_base_url"] } });
  });

  it("typing after a reset saves the typed value instead", () => {
    let draft = resetDraftValue(draftFromSettings(saved), saved, "comfy_base_url");
    draft = editDraftValue(draft, "comfy_base_url", "http://127.0.0.1:9200");

    expect(buildSettingsUpdate(saved, draft)).toEqual({
      update: { comfy_base_url: "http://127.0.0.1:9200" },
    });
  });

  it.each([
    ["draft_caption_threshold", "12.5", "Draft threshold needs a whole number."],
    ["thumbnail_cache_max_mb", "-1", "Cache limit needs a whole number."],
    ["vision_timeout_seconds", "soon", "Timeout needs a number of seconds."],
    ["vision_model", "   ", "Model needs a value."],
  ] as const)("refuses %s = %j before sending", (key, value, error) => {
    const draft = editDraftValue(draftFromSettings(saved), key, value);

    expect(buildSettingsUpdate(saved, draft)).toEqual({ key, error });
  });
});
