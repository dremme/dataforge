import type { ReactNode } from "react";
import type { AppIcon } from "@/shared/icons";
import {
  iconArchive,
  iconArchiveRestore,
  iconCircleQuestionMark,
  iconFilePen,
  iconGroup,
  iconMessageCheck,
  iconMessagePlus,
  iconPencilSparkles,
  iconShredder,
} from "@/shared/icons";
import type { JobType } from "@/shared/types";

/** How the app asks the user before starting this job type. */
type JobStartUi = "dialog" | "confirm" | "immediate";

/** Folder state that decides whether a job can run right now. */
export interface JobAvailability {
  hasCaptionBackup: boolean;
}

interface JobTypeMeta {
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
  /** Whether this job can run in the current folder. Omit for jobs that always can. */
  isAvailable?: (availability: JobAvailability) => boolean;
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
  body_parts: {
    type: "body_parts" as const,
    label: "Body parts",
    icon: iconGroup,
    startUi: "dialog" as const,
    menuLabel: "Detect body parts",
    menuDescription: "Detect body and face; optional SAM keywords.",
  },
  backup_captions: {
    type: "backup_captions" as const,
    label: "Backup captions",
    icon: iconArchive,
    startUi: "immediate" as const,
    menuDescription: "Copy captions and caption issues into the .backup folder.",
  },
  restore_captions: {
    type: "restore_captions" as const,
    label: "Restore captions",
    icon: iconArchiveRestore,
    startUi: "confirm" as const,
    menuDescription: "Bring captions and caption issues back from the .backup folder.",
    confirm: {
      title: "Restore captions from backup?",
      description: (folderLabel: string) => (
        <>
          This overwrites current captions and caption issues in <strong>{folderLabel}</strong> with
          the copies in <strong>.backup</strong>. Files that are not in the backup are left
          untouched.
        </>
      ),
      confirmLabel: "Restore captions",
    },
    isAvailable: ({ hasCaptionBackup }: JobAvailability) => hasCaptionBackup,
  },
} satisfies Record<JobType, JobTypeMeta>;

type JobTypeWithStartUi<Ui extends JobStartUi> = {
  [K in JobType]: (typeof JOB_TYPE_META)[K]["startUi"] extends Ui ? K : never;
}[JobType];

export type ConfirmableJobType = JobTypeWithStartUi<"confirm">;

/** Jobs that start straight from the menu, with no dialog or confirmation. */
export type ImmediateJobType = JobTypeWithStartUi<"immediate">;

const JOB_TYPES = Object.keys(JOB_TYPE_META) as JobType[];

export function isKnownJobType(value: string | null | undefined): value is JobType {
  return typeof value === "string" && Object.hasOwn(JOB_TYPE_META, value);
}

function jobTypeMeta(type: JobType): JobTypeMeta {
  return JOB_TYPE_META[type] as JobTypeMeta;
}

export const PRIMARY_JOB_TYPE: JobType =
  JOB_TYPES.find((type) => jobTypeMeta(type).primary) ?? "auto_caption";

export const SECONDARY_JOB_TYPES: JobType[] = JOB_TYPES.filter(
  (type) => !jobTypeMeta(type).primary,
);

/** Safe for API values that may predate the registry or be unexpected. */
export function jobTypeLabelFor(type: string | null | undefined): string {
  if (isKnownJobType(type)) return JOB_TYPE_META[type].label;
  // Older jobs omit job_type; treat as the primary type for display.
  if (type == null || type.trim() === "") return JOB_TYPE_META[PRIMARY_JOB_TYPE].label;
  return type.trim();
}

export function jobTypeIconFor(type: string | null | undefined): AppIcon {
  if (isKnownJobType(type)) return JOB_TYPE_META[type].icon;
  if (type == null || type.trim() === "") return JOB_TYPE_META[PRIMARY_JOB_TYPE].icon;
  return iconCircleQuestionMark;
}

export function isConfirmableJobType(type: JobType): type is ConfirmableJobType {
  return isKnownJobType(type) && JOB_TYPE_META[type].startUi === "confirm";
}

export function isImmediateJobType(type: JobType): type is ImmediateJobType {
  return isKnownJobType(type) && JOB_TYPE_META[type].startUi === "immediate";
}

/** Whether ``type`` can be started for a folder in this state. */
export function isJobAvailable(type: JobType, availability: JobAvailability): boolean {
  if (!isKnownJobType(type)) return true;
  return jobTypeMeta(type).isAvailable?.(availability) ?? true;
}

export const JOB_START_CONFIRM: Record<ConfirmableJobType, NonNullable<JobTypeMeta["confirm"]>> = {
  strip_metadata: JOB_TYPE_META.strip_metadata.confirm!,
  restore_captions: JOB_TYPE_META.restore_captions.confirm!,
};
