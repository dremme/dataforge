type MediaType = "image" | "video" | "sysprompt";

export type CaptionStatus = "none" | "empty" | "text" | "bboxes_only";

type CaptionFileType = "json" | "txt";

export interface CaptionBBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type?: string;
  label?: string;
}

export interface GalleryItem {
  name: string;
  path: string;
  description: string | null;
  has_description: boolean;
  has_caption_file: boolean;
  issue: string | null;
  issue_suggestions: string | null;
  has_issue_file: boolean;
  has_bboxes: boolean;
  caption_status: CaptionStatus;
  caption_file_type: CaptionFileType | null;
  media_type: MediaType;
  width?: number;
  height?: number;
  frame_count?: number;
  fps?: number;
  size?: number;
  modified_at?: string;
  bboxes?: CaptionBBox[];
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

export interface Subfolder {
  name: string;
  path: string;
  file_count: number;
  captioned_count: number;
  issue_count: number;
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
  bboxes?: CaptionBBox[];
  has_bboxes: boolean;
  issue?: string | null;
  issue_suggestions?: string | null;
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
  | "body_parts"
  | "strip_metadata"
  | "set_captions"
  | "verify_captions"
  | "batch_rename"
  | "backup_captions"
  | "restore_captions";

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
