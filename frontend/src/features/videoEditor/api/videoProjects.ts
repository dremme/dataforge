import { NetworkError, parseApiError, postJson, putJson, requestJson } from "@/shared/api/http";
import type {
  AutoAdjustResponse,
  ColorAdjust,
  VideoProject,
  VideoProjectAutoAdjustRequest,
  VideoProjectDocument,
  VideoProjectExportState,
  VideoProjectExportsResponse,
  VideoProjectFontsResponse,
  VideoProjectGrade,
  VideoProjectGradesResponse,
  VideoProjectListResponse,
  VideoProjectSaveResponse,
  VideoProjectSourceInfo,
  VideoProjectTitle,
  VideoProjectVersionDocument,
  VideoProjectVersionsResponse,
  VideoProjectVersionSummary,
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

/** Converts a video the preview cannot decode to H.264 beside it; the original stays. */
export function makeCompatibleCopy(path: string): Promise<VideoProjectSourceInfo> {
  return postJson(`${BASE}/compatible-copy`, { path });
}

/** The frame at ``time`` as the export's renderer draws it, at the project's full size. */
export async function renderVideoProjectFrame(
  folder: string,
  project: VideoProject,
  time: number,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, project, time }),
    });
  } catch (error) {
    throw new NetworkError({ cause: error });
  }
  if (!response.ok) throw await parseApiError(response);
  return response.blob();
}

export function listVideoProjectVersions(projectId: string): Promise<VideoProjectVersionsResponse> {
  return requestJson(`${BASE}/versions?${new URLSearchParams({ project_id: projectId })}`);
}

export function saveVideoProjectVersion(
  project: VideoProject,
  label: string,
): Promise<VideoProjectVersionSummary> {
  return postJson(`${BASE}/versions`, { project, label });
}

export function readVideoProjectVersion(
  versionId: string,
  folder: string,
): Promise<VideoProjectVersionDocument> {
  return requestJson(
    `${BASE}/versions/${encodeURIComponent(versionId)}?${new URLSearchParams({ folder })}`,
  );
}

export async function deleteVideoProjectVersion(versionId: string): Promise<void> {
  await requestJson<unknown>(`${BASE}/versions/${encodeURIComponent(versionId)}`, {
    method: "DELETE",
  });
}

/** The wand's suggestion for the take and crop one clip shows of its source. */
export function suggestVideoProjectAdjust(
  request: VideoProjectAutoAdjustRequest,
): Promise<AutoAdjustResponse> {
  return postJson(`${BASE}/auto-adjust`, request);
}

export function listVideoProjectGrades(): Promise<VideoProjectGradesResponse> {
  return requestJson(`${BASE}/grades`);
}

/** A taken name, in any case, is replaced. */
export function saveVideoProjectGrade(
  name: string,
  adjust: ColorAdjust,
): Promise<VideoProjectGrade> {
  return postJson(`${BASE}/grades`, { name, adjust });
}

export async function deleteVideoProjectGrade(gradeId: string): Promise<void> {
  await requestJson<unknown>(`${BASE}/grades/${encodeURIComponent(gradeId)}`, { method: "DELETE" });
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
