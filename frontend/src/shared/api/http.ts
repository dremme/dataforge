import type { ApiErrorCode } from "@/shared/types";

export const FOLDER_NOT_FOUND = {
  title: "Folder not found",
  description: "The folder may have been moved, renamed, or deleted.",
} as const;

export const BACKEND_UNREACHABLE = {
  title: "Backend unreachable",
  description: "Start the API server with dev.bat or start-backend.ps1.",
} as const;

const BACKEND_UNREACHABLE_MESSAGE = `${BACKEND_UNREACHABLE.title}. ${BACKEND_UNREACHABLE.description}`;

/** The API answered with an error; `code` is set where the client branches on the reason. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: number,
    message: string,
    readonly code: ApiErrorCode | null = null,
  ) {
    super(message);
  }
}

/** No answer from the API: the request failed, or a gateway replied without a detail. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";

  constructor(options?: ErrorOptions) {
    super(BACKEND_UNREACHABLE_MESSAGE, options);
  }
}

export type FolderError =
  | { kind: "folder-not-found" }
  | { kind: "backend-unreachable" }
  | { kind: "other"; message: string };

export function resolveFolderError(error: unknown): FolderError | null {
  if (error == null) return null;
  if (error instanceof NetworkError) return { kind: "backend-unreachable" };
  if (error instanceof ApiError && error.code === "folder_not_found") {
    return { kind: "folder-not-found" };
  }

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return { kind: "other", message: message || "Something went wrong." };
}

export function isFolderNotFoundError(error: unknown): boolean {
  return resolveFolderError(error)?.kind === "folder-not-found";
}

/** True for a request the caller itself cancelled — never a real failure to report. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** User-facing single-line message for tooltips and inline errors. */
export function formatApiError(error: unknown): string {
  const resolved = resolveFolderError(error);
  if (!resolved) return "Something went wrong.";

  switch (resolved.kind) {
    case "folder-not-found":
      return FOLDER_NOT_FOUND.title;
    case "backend-unreachable":
      return BACKEND_UNREACHABLE_MESSAGE;
    case "other":
      return resolved.message;
  }
}

const GATEWAY_STATUSES = new Set([500, 502, 503, 504]);

export async function parseApiError(response: Response): Promise<ApiError | NetworkError> {
  const body: { detail?: unknown; code?: unknown } = await response.json().catch(() => ({}));
  if (typeof body.detail === "string") {
    const code = typeof body.code === "string" ? (body.code as ApiErrorCode) : null;
    return new ApiError(response.status, body.detail, code);
  }
  // A dev proxy answers 5xx without a body while the API process is down.
  if (GATEWAY_STATUSES.has(response.status)) return new NetworkError();
  return new ApiError(response.status, `Request failed (${response.status})`);
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    // A cancelled request must stay recognizable as such: wrapping it would surface a
    // superseded navigation as a backend failure.
    if (isAbortError(error)) throw error;
    throw new NetworkError({ cause: error });
  }

  if (!response.ok) {
    throw await parseApiError(response);
  }
  return response.json() as Promise<T>;
}

function jsonInit(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function postJson<T>(url: string, body: unknown, init?: RequestInit): Promise<T> {
  return requestJson<T>(url, { ...jsonInit("POST", body), ...init });
}

export async function putJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, jsonInit("PUT", body));
}
