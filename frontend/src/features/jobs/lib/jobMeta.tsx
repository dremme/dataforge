import type { ReactNode } from "react";
import type { AppIcon } from "@/shared/icons";
import {
  iconArchive,
  iconArchiveRestore,
  iconBrain,
  iconCircleQuestionMark,
  iconComfyUi,
  iconFilePen,
  iconFiles,
  iconMessagePlus,
  iconMessageWarning,
  iconPencilSparkles,
  iconReplace,
  iconShredder,
  iconSparkles,
  iconStamp,
} from "@/shared/icons";
import type { JobType } from "@/shared/types";

type JobStartUi = "dialog" | "confirm";

export interface JobAvailability {
  hasCaptionBackup: boolean;
  ostrisAvailable: boolean;
  comfyPresetsAvailable: boolean;
}

export const JOB_GROUPS = [
  { id: "datasets", label: "Datasets" },
  { id: "backup", label: "Backup" },
  { id: "files", label: "Files" },
] as const;

export type JobGroup = (typeof JOB_GROUPS)[number]["id"];

interface JobTypeMeta {
  type: JobType;
  label: string;
  icon: AppIcon;
  startUi: JobStartUi;
  group: JobGroup;
  primary?: boolean;
  menuLabel?: string;
  menuDescription?: string;
  confirm?: {
    title: string;
    description: () => ReactNode;
    confirmLabel: string;
  };
  isAvailable?: (availability: JobAvailability) => boolean;
}

export const JOB_TYPE_META = {
  auto_caption: {
    type: "auto_caption" as const,
    group: "datasets" as const,
    label: "Auto-caption",
    icon: iconSparkles,
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
    icon: iconMessageWarning,
    startUi: "dialog" as const,
    menuDescription: "Verifies captions by comparing them with their media file.",
  },
  edit_captions: {
    type: "edit_captions" as const,
    group: "datasets" as const,
    label: "Edit captions",
    icon: iconPencilSparkles,
    startUi: "dialog" as const,
    menuDescription: "Rewrite existing captions with the local model, from your instruction.",
  },
  replace_captions: {
    type: "replace_captions" as const,
    group: "datasets" as const,
    label: "Find & replace",
    icon: iconReplace,
    startUi: "dialog" as const,
    menuDescription: "Search and replace, prepend, or append text across captions.",
  },
  train_lora: {
    type: "train_lora" as const,
    group: "datasets" as const,
    label: "LoRA training",
    icon: iconBrain,
    startUi: "dialog" as const,
    menuLabel: "Quick LoRA training",
    menuDescription: "Train an image or video LoRA on this folder with AI-Toolkit.",
    isAvailable: ({ ostrisAvailable }: JobAvailability) => ostrisAvailable,
  },
  batch_rename: {
    type: "batch_rename" as const,
    group: "files" as const,
    label: "Rename",
    icon: iconFilePen,
    startUi: "dialog" as const,
    menuDescription: "Rename media files.",
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
      description: () => <>Removes embedded metadata from every PNG and MP4 in scope.</>,
      confirmLabel: "Start strip metadata",
    },
  },
  find_duplicates: {
    type: "find_duplicates" as const,
    group: "files" as const,
    label: "Find duplicates",
    icon: iconFiles,
    startUi: "dialog" as const,
    menuDescription: "Flag duplicate and near-duplicate media as caption issues.",
  },
  backup_captions: {
    type: "backup_captions" as const,
    group: "backup" as const,
    label: "Backup captions",
    icon: iconArchive,
    startUi: "dialog" as const,
    menuDescription: "Copy captions into the .backup folder.",
  },
  restore_captions: {
    type: "restore_captions" as const,
    group: "backup" as const,
    label: "Restore captions",
    icon: iconArchiveRestore,
    startUi: "confirm" as const,
    menuDescription: "Bring captions back from the .backup folder.",
    confirm: {
      title: "Restore captions from backup?",
      description: () => (
        <>
          Overwrites their current captions with the copies in <strong>.backup</strong>. Files that
          are not in the backup are left untouched.
        </>
      ),
      confirmLabel: "Restore captions",
    },
    isAvailable: ({ hasCaptionBackup }: JobAvailability) => hasCaptionBackup,
  },
  watermark: {
    type: "watermark" as const,
    group: "files" as const,
    label: "Watermark",
    icon: iconStamp,
    startUi: "dialog" as const,
    menuDescription: "Adds a watermark to media files.",
  },
  comfy_process: {
    type: "comfy_process" as const,
    group: "files" as const,
    label: "Process with ComfyUI",
    icon: iconComfyUi,
    startUi: "dialog" as const,
    menuLabel: "Process with ComfyUI",
    menuDescription: "Upscale or repair images through a ComfyUI workflow, for review.",
    isAvailable: ({ comfyPresetsAvailable }: JobAvailability) => comfyPresetsAvailable,
  },
} satisfies Record<JobType, JobTypeMeta>;

type JobTypeWithStartUi<Ui extends JobStartUi> = {
  [K in JobType]: (typeof JOB_TYPE_META)[K]["startUi"] extends Ui ? K : never;
}[JobType];

export type ConfirmableJobType = JobTypeWithStartUi<"confirm">;

const JOB_TYPES = Object.keys(JOB_TYPE_META) as JobType[];

export function isKnownJobType(value: string): value is JobType {
  return Object.hasOwn(JOB_TYPE_META, value);
}

function jobTypeMeta(type: JobType): JobTypeMeta {
  return JOB_TYPE_META[type] as JobTypeMeta;
}

export const PRIMARY_JOB_TYPE: JobType =
  JOB_TYPES.find((type) => jobTypeMeta(type).primary) ?? "auto_caption";

export const SECONDARY_JOB_TYPES: JobType[] = JOB_TYPES.filter(
  (type) => !jobTypeMeta(type).primary,
);

export const SECONDARY_JOB_GROUPS: Array<{ id: JobGroup; label: string; types: JobType[] }> =
  JOB_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    types: SECONDARY_JOB_TYPES.filter((type) => jobTypeMeta(type).group === group.id),
  })).filter((group) => group.types.length > 0);

export function jobTypeLabelFor(type: string): string {
  return isKnownJobType(type) ? JOB_TYPE_META[type].label : type.trim();
}

export function jobTypeIconFor(type: string): AppIcon {
  return isKnownJobType(type) ? JOB_TYPE_META[type].icon : iconCircleQuestionMark;
}

export function isConfirmableJobType(type: JobType): type is ConfirmableJobType {
  return isKnownJobType(type) && JOB_TYPE_META[type].startUi === "confirm";
}

export function isJobAvailable(type: JobType, availability: JobAvailability): boolean {
  if (!isKnownJobType(type)) return true;
  return jobTypeMeta(type).isAvailable?.(availability) ?? true;
}

export const JOB_START_CONFIRM: Record<ConfirmableJobType, NonNullable<JobTypeMeta["confirm"]>> = {
  strip_metadata: JOB_TYPE_META.strip_metadata.confirm!,
  restore_captions: JOB_TYPE_META.restore_captions.confirm!,
};
