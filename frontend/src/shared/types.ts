type MediaType = "image" | "video" | "sysprompt";

export type CaptionStatus = "none" | "empty" | "text";

export type CaptionFileType = "json" | "txt";

export interface GalleryItem {
  name: string;
  path: string;
  description: string | null;
  has_description: boolean;
  has_caption_file: boolean;
  issue_fixes: string[];
  has_issue_file: boolean;
  caption_status: CaptionStatus;
  caption_file_type: CaptionFileType | null;
  media_type: MediaType;
  width?: number;
  height?: number;
  frame_count?: number;
  fps?: number;
  size?: number;
  modified_at?: string;
}

export interface Breadcrumb {
  name: string;
  path: string;
}

interface FolderRoot {
  name: string;
  path: string;
}

export interface FolderRootsResponse {
  home: string;
  roots: FolderRoot[];
}

/** Lightweight child folder (no media/caption stats). */
export interface FolderChild {
  name: string;
  path: string;
}

export interface FolderChildrenResponse {
  folder: string;
  children: FolderChild[];
}

export interface FolderFavorite {
  name: string;
  path: string;
}

export interface FolderFavoritesResponse {
  favorites: FolderFavorite[];
}

export interface FolderOpenResponse {
  path: string;
}

export interface FolderCreateResponse {
  name: string;
  path: string;
  file_count: number;
  captioned_count: number;
  issue_count: number;
}

/** Shared by move and copy: only the endpoint decides whether the source survives. */
export interface MediaTransferPreviewResponse {
  eligible: string[];
  conflicts: string[];
  skipped: string[];
}

interface MediaTransferItemResponse {
  source: string;
  destination: string;
  files: string[];
}

interface MediaTransferFailure {
  path: string;
  detail: string;
}

export interface MediaTransferResponse {
  transferred: MediaTransferItemResponse[];
  skipped: string[];
  failed: MediaTransferFailure[];
}

/**
 * A child folder card.
 *
 * The counts are `null` in a browse response — computing them means reading every
 * caption sidecar in every child folder, so they arrive separately from
 * `/api/browse/subfolder-stats` and are merged in once they land.
 */
export interface Subfolder {
  name: string;
  path: string;
  file_count: number | null;
  captioned_count: number | null;
  issue_count: number | null;
}

export interface SubfolderStats {
  path: string;
  file_count: number;
  captioned_count: number;
  issue_count: number;
}

export interface SubfolderStatsResponse {
  folder: string;
  subfolders: SubfolderStats[];
}

export interface PngWorkflowResponse {
  has_workflow: boolean;
}

export interface CaptionSaveResponse {
  description: string | null;
  has_description: boolean;
  has_caption_file: boolean;
  caption_status: CaptionStatus;
  caption_file: string;
  caption_file_type: CaptionFileType | null;
  caption_content?: string | null;
  issue_fixes?: string[];
  has_issue_file?: boolean;
}

export interface SysPromptSaveResponse {
  description: string | null;
  has_description: boolean;
  has_caption_file: boolean;
  caption_status: CaptionStatus;
  path: string;
}

export interface BrowseFingerprintResponse {
  fingerprint: string;
}

export interface FileImportPreviewResponse {
  importable: string[];
  new_files: string[];
  conflicts: string[];
  rejected: string[];
}

export interface FileImportResponse {
  copied: string[];
  skipped: string[];
  rejected: string[];
}

export interface BrowseResponse {
  folder: string;
  home: string;
  parent: string | null;
  breadcrumbs: Breadcrumb[];
  subfolders: Subfolder[];
  items: GalleryItem[];
  sysprompt: GalleryItem | null;
  has_caption_backup: boolean;
  item_count: number;
  subfolder_count: number;
  fingerprint: string;
}

export type JobType =
  | "auto_caption"
  | "strip_metadata"
  | "set_captions"
  | "verify_captions"
  | "batch_rename"
  | "backup_captions"
  | "restore_captions"
  | "train_lora";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

interface JobFileResult {
  path: string;
  name: string;
  status: string;
  description?: string | null;
  preview?: string | null;
  message?: string | null;
}

export interface Job {
  id: string;
  folder: string;
  folder_name?: string;
  job_type?: JobType;
  status: JobStatus;
  total: number;
  processed: number;
  current_file?: string | null;
  current_name?: string | null;
  stats: Record<string, number>;
  results: JobFileResult[];
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  auto_caption_mode?: string | null;
  /** The external job this one co-tracks (the AI-Toolkit training name). */
  external_ref?: string | null;
}

export interface JobsResponse {
  jobs: Job[];
  active_count: number;
}

export interface ExternalOstrisJob {
  id: string;
  name: string;
  status: string;
  step: number;
  total_steps: number | null;
  info: string | null;
  speed_string: string | null;
  job_type: string | null;
  dataset_folder: string | null;
  dataset_folder_name: string;
  model: string | null;
  created_at: string | null;
  save_now: boolean;
  stop_requested: boolean;
}

export interface ExternalOstrisJobStopResponse {
  success: boolean;
  message: string | null;
}

export interface ExternalOstrisJobsResponse {
  jobs: ExternalOstrisJob[];
  active_count: number;
  available: boolean;
}

export interface OstrisTrainingSample {
  path: string;
  name: string;
  step: number;
  prompt: string;
}

export interface OstrisTrainingSamplesResponse {
  samples: OstrisTrainingSample[];
  step: number | null;
  available: boolean;
}

export interface SystemSpecs {
  cpu_name: string;
  cpu_cores: number;
  memory_total_bytes: number;
  memory_used_bytes: number;
  gpu_name: string | null;
  gpu_memory_bytes: number | null;
  gpu_memory_used_bytes: number | null;
  gpu_available: boolean;
}

export interface JobDeleteResponse {
  deleted_count: number;
}

/**
 * Request bodies, mirroring the models in `backend/schemas.py` by hand.
 *
 * Optional here wherever the backend declares a default, so omitting a field is the
 * same "use the default" the API already means. Field names stay snake_case: these
 * cross the wire verbatim.
 */

export type AutomationMode = "thinking" | "instruct";

/** Base of every job start: omit `paths` to process the whole folder. */
export interface JobSelectionRequest {
  paths?: string[];
}

export interface AutoCaptionStartRequest extends JobSelectionRequest {
  mode?: AutomationMode;
}

export interface SetCaptionsStartRequest extends JobSelectionRequest {
  caption?: string;
  overwrite?: boolean;
}

export interface BatchRenameStartRequest extends JobSelectionRequest {
  stem?: string;
}

export interface VerifyCaptionsStartRequest extends JobSelectionRequest {
  mode?: AutomationMode;
  context?: string;
}

export interface TrainLoraStartRequest extends JobSelectionRequest {
  lora_name?: string;
  trigger_word?: string;
  prompts?: string[];
}

/** Selects the body shape for a given job type. */
export interface JobStartBodies {
  auto_caption: AutoCaptionStartRequest;
  set_captions: SetCaptionsStartRequest;
  verify_captions: VerifyCaptionsStartRequest;
  batch_rename: BatchRenameStartRequest;
  train_lora: TrainLoraStartRequest;
  strip_metadata: JobSelectionRequest;
  backup_captions: JobSelectionRequest;
  restore_captions: JobSelectionRequest;
}

/** Any job's body, for callers whose job type is only known at runtime. */
export type JobStartBody = JobStartBodies[JobType];

export interface CaptionUpdate {
  text?: string;
  json_content?: string | null;
  resolve_issue?: boolean;
}

export interface FileImportPreviewRequest {
  filenames?: string[];
}

export interface MediaTransferRequest {
  paths?: readonly string[];
}

export interface UiSettingsUpdate {
  sort?: string;
  show_automation_specs?: boolean;
}

export interface VerifyCaptionsSettingsUpdate {
  mode?: AutomationMode;
  context?: string;
  folder_path: string;
}
