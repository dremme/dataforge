import type { ReactNode } from "react";
import type { AppIcon } from "@/shared/icons";
import {
  iconArchive,
  iconArchiveRestore,
  iconBrain,
  iconCircleQuestionMark,
  iconFilePen,
  iconMessageCheck,
  iconMessagePlus,
  iconPencilSparkles,
  iconShredder,
  iconStamp,
} from "@/shared/icons";
import type { JobType } from "@/shared/types";

/** How the app asks the user before starting this job type. */
type JobStartUi = "dialog" | "confirm" | "immediate";

/** Folder state that decides whether a job can run right now. */
export interface JobAvailability {
  hasCaptionBackup: boolean;
  ostrisAvailable: boolean;
}

/** Sections of the secondary jobs menu, in display order. */
export const JOB_GROUPS = [
  { id: "datasets", label: "Datasets" },
  { id: "files", label: "Files" },
  { id: "backup", label: "Backup" },
] as const;

export type JobGroup = (typeof JOB_GROUPS)[number]["id"];

interface JobTypeMeta {
  type: JobType;
  label: string;
  icon: AppIcon;
  startUi: JobStartUi;
  /** Menu section. Required on every job so a new one cannot land nowhere. */
  group: JobGroup;
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
    group: "datasets" as const,
    label: "Auto-caption",
    icon: iconPencilSparkles,
    startUi: "dialog" as const,
    primary: true as const,
    menuDescription: "Auto-complete captions with the local model.",
  },
  set_captions: {
    type: "set_captions" as const,
    group: "datasets" as const,
    label: "Set captions",
    icon: iconMessagePlus,
    startUi: "dialog" as const,
    menuDescription: "Write the same caption text to media files.",
  },
  verify_captions: {
    type: "verify_captions" as const,
    group: "datasets" as const,
    label: "Verify captions",
    icon: iconMessageCheck,
    startUi: "dialog" as const,
    menuDescription: "Verifies captions by comparing them with their media file.",
  },
  batch_rename: {
    type: "batch_rename" as const,
    group: "files" as const,
    label: "Batch rename",
    icon: iconFilePen,
    startUi: "dialog" as const,
    menuDescription: "Rename media files.",
  },
  watermark: {
    type: "watermark" as const,
    group: "files" as const,
    label: "Batch watermark",
    icon: iconStamp,
    startUi: "dialog" as const,
    menuDescription: "Adds a watermark to media files.",
  },
  strip_metadata: {
    type: "strip_metadata" as const,
    group: "files" as const,
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
  backup_captions: {
    type: "backup_captions" as const,
    group: "backup" as const,
    label: "Backup captions",
    icon: iconArchive,
    startUi: "immediate" as const,
    menuDescription: "Copy captions and caption issues into the .backup folder.",
  },
  restore_captions: {
    type: "restore_captions" as const,
    group: "backup" as const,
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
  train_lora: {
    type: "train_lora" as const,
    group: "datasets" as const,
    label: "LoRA training",
    icon: iconBrain,
    startUi: "dialog" as const,
    menuLabel: "Quick LoRA training",
    menuDescription: "Train a Krea 2 Turbo LoRA on this folder with AI-Toolkit.",
    isAvailable: ({ ostrisAvailable }: JobAvailability) => ostrisAvailable,
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

/**
 * Secondary jobs bucketed into menu sections, in `JOB_GROUPS` order, with jobs
 * keeping their registry order inside each. Sections with no jobs are dropped,
 * so the menu needs no knowledge of which groups are populated.
 */
export const SECONDARY_JOB_GROUPS: Array<{ id: JobGroup; label: string; types: JobType[] }> =
  JOB_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    types: SECONDARY_JOB_TYPES.filter((type) => jobTypeMeta(type).group === group.id),
  })).filter((group) => group.types.length > 0);

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
