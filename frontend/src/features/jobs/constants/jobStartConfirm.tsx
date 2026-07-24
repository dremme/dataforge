import type { ReactNode } from "react";
import type { JobType } from "@/shared/types";

export type ConfirmableJobType = Exclude<
  JobType,
  "auto_caption" | "body_parts" | "set_captions" | "verify_captions" | "batch_rename"
>;

export const JOB_START_CONFIRM: Record<
  ConfirmableJobType,
  { title: string; description: (folderLabel: string) => ReactNode; confirmLabel: string }
> = {
  strip_metadata: {
    title: "Start strip metadata?",
    description: (folderLabel) => (
      <>
        Remove embedded metadata from PNGs and MP4s in <strong>{folderLabel}</strong>.
      </>
    ),
    confirmLabel: "Start strip metadata",
  },
};
