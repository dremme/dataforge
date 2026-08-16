import type {
  AutoCaptionStartRequest,
  BackupCaptionsStartRequest,
  BatchRenameStartRequest,
  FindDuplicatesStartRequest,
  JobType,
  ReplaceCaptionsStartRequest,
  RestoreCaptionsStartRequest,
  SetCaptionsStartRequest,
  StripMetadataStartRequest,
  TrainLoraStartRequest,
  VerifyCaptionsStartRequest,
  WatermarkStartRequest,
} from "@/shared/types";

/**
 * Selects the body shape for a given job type.
 *
 * Derived from the generated request types rather than mirroring them, so renaming a
 * body model on the backend fails this file at compile time instead of drifting.
 */
export interface JobStartBodies {
  auto_caption: AutoCaptionStartRequest;
  set_captions: SetCaptionsStartRequest;
  replace_captions: ReplaceCaptionsStartRequest;
  find_duplicates: FindDuplicatesStartRequest;
  verify_captions: VerifyCaptionsStartRequest;
  batch_rename: BatchRenameStartRequest;
  train_lora: TrainLoraStartRequest;
  watermark: WatermarkStartRequest;
  strip_metadata: StripMetadataStartRequest;
  backup_captions: BackupCaptionsStartRequest;
  restore_captions: RestoreCaptionsStartRequest;
}

/** Any job's body, for callers whose job type is only known at runtime. */
export type JobStartBody = JobStartBodies[JobType];
