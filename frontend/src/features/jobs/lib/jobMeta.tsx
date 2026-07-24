import type { ReactNode } from "react";
import type { AppIcon } from "@/shared/icons";
import {
  iconFilePen,
  iconGroup,
  iconMessageCheck,
  iconMessagePlus,
  iconPencilSparkles,
  iconShredder,
} from "@/shared/icons";
import type { JobType } from "@/shared/types";

/** How the app asks the user before starting this job type. */
export type JobStartUi = "dialog" | "confirm";

export interface JobTypeMeta {
  type: JobType;
  label: string;
  icon: AppIcon;
  startUi: JobStartUi;
  /** Primary panel CTA (auto-caption). Others appear in the more-jobs menu. */
  primary?: boolean;
  /** Label in the secondary jobs menu (defaults to label). */
  menuLabel?: string;
  /** Short description in the secondary jobs menu. */
  menuDescription?: string;
  /** Confirm-dialog copy when startUi is "confirm". */
  confirm?: {
    title: string;
    description: (folderLabel: string) => ReactNode;
    confirmLabel: string;
  };
}

/**
 * Single source of truth for job presentation and start UX.
 * Adding a job type: extend JobType, add an entry here, wire API + dialog if needed.
 */
export const JOB_TYPE_META = {
  auto_caption: {
    type: "auto_caption" as const,
    label: "Auto-caption",
    icon: iconPencilSparkles,
    startUi: "dialog" as const,
    primary: true as const,
    menuDescription: "Auto-complete captions with the local model.",
  },
  body_parts: {
    type: "body_parts" as const,
    label: "Body parts",
    icon: iconGroup,
    startUi: "dialog" as const,
    menuLabel: "Detect body parts",
    menuDescription: "Detect body and face; optional SAM keywords.",
  },
  strip_metadata: {
    type: "strip_metadata" as const,
    label: "Strip metadata",
    icon: iconShredder,
    startUi: "confirm" as const,
    menuDescription: "Remove embedded metadata from media files.",
    confirm: {
      title: "Start strip metadata?",
      description: (folderLabel: string) => (
        <>
          Remove embedded metadata from PNGs and MP4s in <strong>{folderLabel}</strong>.
        </>
      ),
      confirmLabel: "Start strip metadata",
    },
  },
  set_captions: {
    type: "set_captions" as const,
    label: "Set captions",
    icon: iconMessagePlus,
    startUi: "dialog" as const,
    menuDescription: "Write the same caption text to media files.",
  },
  verify_captions: {
    type: "verify_captions" as const,
    label: "Verify captions",
    icon: iconMessageCheck,
    startUi: "dialog" as const,
    menuDescription: "Verifies captions by comparing them with their media file.",
  },
  batch_rename: {
    type: "batch_rename" as const,
    label: "Batch rename",
    icon: iconFilePen,
    startUi: "dialog" as const,
    menuDescription: "Rename media files.",
  },
} satisfies Record<JobType, JobTypeMeta>;

export type ConfirmableJobType = {
  [K in JobType]: (typeof JOB_TYPE_META)[K]["startUi"] extends "confirm" ? K : never;
}[JobType];

export const JOB_TYPES = Object.keys(JOB_TYPE_META) as JobType[];

export function jobTypeMeta(type: JobType): JobTypeMeta {
  return JOB_TYPE_META[type] as JobTypeMeta;
}

export const PRIMARY_JOB_TYPE: JobType =
  JOB_TYPES.find((type) => jobTypeMeta(type).primary) ?? "auto_caption";

export const SECONDARY_JOB_TYPES: JobType[] = JOB_TYPES.filter(
  (type) => !jobTypeMeta(type).primary,
);

export function jobTypeLabelFor(type: JobType): string {
  return JOB_TYPE_META[type].label;
}

export function jobTypeIconFor(type: JobType): AppIcon {
  return JOB_TYPE_META[type].icon;
}

export function isConfirmableJobType(type: JobType): type is ConfirmableJobType {
  return JOB_TYPE_META[type].startUi === "confirm";
}

export const JOB_START_CONFIRM: Record<ConfirmableJobType, NonNullable<JobTypeMeta["confirm"]>> = {
  strip_metadata: JOB_TYPE_META.strip_metadata.confirm!,
};
