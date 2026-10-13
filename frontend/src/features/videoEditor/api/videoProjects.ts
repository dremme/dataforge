import { postJson, putJson, requestJson } from "@/shared/api/http";
import type {
  AutoAdjustResponse,
  VideoProject,
  VideoProjectAutoAdjustRequest,
  VideoProjectDocument,
  VideoProjectExportState,
  VideoProjectExportsResponse,
  VideoProjectFontsResponse,
  VideoProjectListResponse,
  VideoProjectSaveResponse,
  VideoProjectSourceInfo,
  VideoProjectTitle,
} from "@/shared/types";

const BASE = "/api/video-projects";

export function startVideoProject(videoPath: string): Promise<VideoProjectDocument> {
  return requestJson(`${BASE}/start?${new URLSearchParams({ path: videoPath })}`);
}

export function newVideoProject(folder: string): Promise<VideoProjectDocument> {
  return requestJson(`${BASE}/new?${new URLSearchParams({ folder })}`);
}

export function openVideoProject(projectPath: string): Promise<VideoProjectDocument> {
  return requestJson(`${BASE}/project?${new URLSearchParams({ path: projectPath })}`);
}

export function listVideoProjects(folder: string): Promise<VideoProjectListResponse> {
  return requestJson(`${BASE}?${new URLSearchParams({ folder })}`);
}

export function saveVideoProject(
  folder: string,
  path: string | null,
  baseRevision: number | null,
  project: VideoProject,
): Promise<VideoProjectSaveResponse> {
  return putJson(`${BASE}/project`, { folder, path, base_revision: baseRevision, project });
}

export async function deleteVideoProject(projectPath: string): Promise<void> {
  await requestJson<unknown>(`${BASE}/project?${new URLSearchParams({ path: projectPath })}`, {
    method: "DELETE",
  });
}

export function probeVideoProjectSource(path: string): Promise<VideoProjectSourceInfo> {
  return requestJson(`${BASE}/source?${new URLSearchParams({ path })}`);
}

/** The wand's suggestion for the take and crop one clip shows of its source. */
export function suggestVideoProjectAdjust(
  request: VideoProjectAutoAdjustRequest,
): Promise<AutoAdjustResponse> {
  return postJson(`${BASE}/auto-adjust`, request);
}

export function listVideoProjectFonts(): Promise<VideoProjectFontsResponse> {
  return requestJson(`${BASE}/fonts`);
}

export function startVideoProjectExport(
  folder: string,
  projectPath: string | null,
  project: VideoProject,
): Promise<VideoProjectExportState> {
  return postJson(`${BASE}/exports`, { folder, project_path: projectPath, project });
}

export function listVideoProjectExports(): Promise<VideoProjectExportsResponse> {
  return requestJson(`${BASE}/exports`);
}

export function cancelVideoProjectExport(id: string): Promise<VideoProjectExportState> {
  return requestJson(`${BASE}/exports/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export async function dismissVideoProjectExport(id: string): Promise<void> {
  await requestJson<unknown>(`${BASE}/exports/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** The exact layer the export draws; the preview shows this image rather than its own text. */
export function titleImageUrl(title: VideoProjectTitle, width: number, height: number): string {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    spec: JSON.stringify(title),
  });
  return `${BASE}/title?${params}`;
}

export function filmstripUrl(
  path: string,
  start: number,
  end: number,
  count: number,
  height: number,
  version: string,
): string {
  const params = new URLSearchParams({
    path,
    start: start.toFixed(2),
    end: end.toFixed(2),
    count: String(count),
    height: String(height),
    v: version,
  });
  return `${BASE}/filmstrip?${params}`;
}

export function waveformUrl(path: string, width: number, version: string): string {
  return `${BASE}/waveform?${new URLSearchParams({ path, width: String(width), v: version })}`;
}
