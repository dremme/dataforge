import { requestJson } from "@/shared/api/http";
import type { FileImportPreviewResponse, FileImportResponse } from "@/shared/types";

export async function previewFileImport(
  folderPath: string,
  filenames: string[],
): Promise<FileImportPreviewResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<FileImportPreviewResponse>(`/api/files/import/preview?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filenames }),
  });
}

export async function importFiles(
  folderPath: string,
  files: File[],
  overwrite = false,
): Promise<FileImportResponse> {
  const params = new URLSearchParams({
    path: folderPath,
    overwrite: String(overwrite),
  });
  const body = new FormData();
  for (const file of files) {
    body.append("files", file, file.name);
  }

  return requestJson<FileImportResponse>(`/api/files/import?${params}`, {
    method: "POST",
    body,
  });
}
