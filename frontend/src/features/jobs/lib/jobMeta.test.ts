import { describe, expect, it } from "vitest";
import type { JobType } from "@/shared/types";
import {
  JOB_GROUPS,
  JOB_START_CONFIRM,
  JOB_TYPE_META,
  SECONDARY_JOB_GROUPS,
  SECONDARY_JOB_TYPES,
  isConfirmableJobType,
  isJobAvailable,
} from "./jobMeta";

const withBackup = { hasCaptionBackup: true, ostrisAvailable: true, comfyPresetsAvailable: true };
const withoutBackup = {
  hasCaptionBackup: false,
  ostrisAvailable: true,
  comfyPresetsAvailable: true,
};

describe("isJobAvailable", () => {
  it("blocks restore captions until a backup exists", () => {
    expect(isJobAvailable("restore_captions", withoutBackup)).toBe(false);
    expect(isJobAvailable("restore_captions", withBackup)).toBe(true);
  });

  it("blocks LoRA training until AI-Toolkit is reachable", () => {
    expect(isJobAvailable("train_lora", { ...withBackup, ostrisAvailable: false })).toBe(false);
    expect(isJobAvailable("train_lora", withBackup)).toBe(true);
  });

  it("blocks the ComfyUI job until a workflow preset exists", () => {
    expect(isJobAvailable("comfy_process", { ...withBackup, comfyPresetsAvailable: false })).toBe(
      false,
    );
    expect(isJobAvailable("comfy_process", withBackup)).toBe(true);
  });

  it("leaves every other job available either way", () => {
    const gated = new Set<JobType>(["restore_captions", "train_lora", "comfy_process"]);
    const others = SECONDARY_JOB_TYPES.filter((type) => !gated.has(type));
    expect(others.length).toBeGreaterThan(0);

    for (const type of others) {
      expect(isJobAvailable(type, withoutBackup)).toBe(true);
      expect(isJobAvailable(type, withBackup)).toBe(true);
    }
  });

  it("tolerates a job type the registry does not know", () => {
    expect(isJobAvailable("legacy_job" as JobType, withoutBackup)).toBe(true);
  });
});

describe("JOB_START_CONFIRM", () => {
  it("gives every confirm-started job its dialog copy", () => {
    const confirmable = (Object.keys(JOB_TYPE_META) as JobType[]).filter(isConfirmableJobType);
    expect(confirmable).toContain("restore_captions");

    // Backing up asks for an overwrite choice, so it needs a dialog rather than a confirm.
    expect(confirmable).not.toContain("backup_captions");

    // `confirm` is optional on the registry entry, so a confirm job could otherwise
    // reach the dialog with nothing to render.
    for (const type of confirmable) {
      const copy = JOB_START_CONFIRM[type];
      expect(copy?.title).toBeTruthy();
      expect(copy?.confirmLabel).toBeTruthy();
      expect(copy?.description()).toBeTruthy();
    }
  });
});

describe("SECONDARY_JOB_GROUPS", () => {
  it("gives every secondary job exactly one section", () => {
    const grouped = SECONDARY_JOB_GROUPS.flatMap((group) => group.types);

    // A job missing a section would vanish from the menu entirely.
    expect([...grouped].sort()).toEqual([...SECONDARY_JOB_TYPES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("keeps sections in registry order and drops empty ones", () => {
    const declaredOrder = JOB_GROUPS.map((group) => group.id);
    const rendered = SECONDARY_JOB_GROUPS.map((group) => group.id);

    expect(rendered).toEqual(declaredOrder.filter((id) => rendered.includes(id)));
    expect(SECONDARY_JOB_GROUPS.every((group) => group.types.length > 0)).toBe(true);
  });

  it("buckets the dataset, file and backup jobs apart", () => {
    const byId = Object.fromEntries(SECONDARY_JOB_GROUPS.map((group) => [group.id, group.types]));

    expect(byId.datasets).toContain("set_captions");
    expect(byId.datasets).toContain("edit_captions");
    expect(byId.datasets).toContain("train_lora");
    expect(byId.files).toContain("batch_rename");
    expect(byId.backup).toEqual(["backup_captions", "restore_captions"]);
  });
});
