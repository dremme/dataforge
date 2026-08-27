import type {
  AutoCaptionStartRequest,
  BackupCaptionsStartRequest,
  BatchRenameStartRequest,
  ComfyProcessStartRequest,
  FindDuplicatesStartRequest,
  JobType,
  ReplaceCaptionsStartRequest,
  RestoreCaptionsStartRequest,
  SetCaptionsStartRequest,
  StripMetadataStartRequest,
  TrainLoraStartRequest,
  EditCaptionsStartRequest,
  VerifyCaptionsStartRequest,
  WatermarkStartRequest,
} from "@/shared/types";

/** Derived from generated request types so a renamed body model fails at compile time. */
export interface JobStartBodies {
  auto_caption: AutoCaptionStartRequest;
  set_captions: SetCaptionsStartRequest;
  replace_captions: ReplaceCaptionsStartRequest;
  find_duplicates: FindDuplicatesStartRequest;
  verify_captions: VerifyCaptionsStartRequest;
  edit_captions: EditCaptionsStartRequest;
  batch_rename: BatchRenameStartRequest;
  train_lora: TrainLoraStartRequest;
  watermark: WatermarkStartRequest;
  comfy_process: ComfyProcessStartRequest;
  strip_metadata: StripMetadataStartRequest;
  backup_captions: BackupCaptionsStartRequest;
  restore_captions: RestoreCaptionsStartRequest;
}

/** Any job's body, for callers whose job type is only known at runtime. */
export type JobStartBody = JobStartBodies[JobType];
