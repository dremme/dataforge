export const FOLDER_NOT_FOUND = {
  title: "Folder not found",
  description: "The folder may have been moved, renamed, or deleted.",
} as const;

export const BACKEND_UNREACHABLE = {
  title: "Backend unreachable",
  description: "Start the API server with start.bat or start-backend.ps1.",
} as const;

/** Matches the API `detail` field for missing folders. */
export const FOLDER_NOT_FOUND_MESSAGE = FOLDER_NOT_FOUND.title;

export type FolderError =
  | { kind: "folder-not-found" }
  | { kind: "backend-unreachable" }
  | { kind: "other"; message: string };

const GATEWAY_STATUS_RE = /^request failed \((500|502|503|504)\)$/i;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function isBackendUnreachableMessage(message: string): boolean {
  const trimmed = message.trim();
  return (
    GATEWAY_STATUS_RE.test(trimmed) ||
    trimmed === BACKEND_UNREACHABLE.description ||
    trimmed.startsWith(BACKEND_UNREACHABLE.title) ||
    trimmed.startsWith("The backend is unreachable") ||
    trimmed === "Failed to fetch"
  );
}

function isNetworkFailureHttpResponse(status: number, detail: unknown): boolean {
  if (typeof detail === "string" && detail.length > 0) {
    return false;
  }
  return status === 500 || status === 502 || status === 503 || status === 504;
}

export function resolveFolderError(error: unknown): FolderError | null {
  if (error == null) return null;

  const message = errorMessage(error);
  if (!message) {
    return { kind: "other", message: "Something went wrong." };
  }

  if (message === FOLDER_NOT_FOUND_MESSAGE) {
    return { kind: "folder-not-found" };
  }

  if (isBackendUnreachableMessage(message)) {
    return { kind: "backend-unreachable" };
  }

  return { kind: "other", message };
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
      return `${BACKEND_UNREACHABLE.title}. ${BACKEND_UNREACHABLE.description}`;
    case "other":
      return resolved.message;
  }
}

export async function parseApiError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}));
  const detail = body.detail;
  if (typeof detail === "string") return detail;
  if (isNetworkFailureHttpResponse(response.status, detail)) {
    return BACKEND_UNREACHABLE.description;
  }
  return `Request failed (${response.status})`;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    // A cancelled request must stay recognizable as such: wrapping it in a
    // generic Error would surface a superseded navigation as a backend failure.
    if (isAbortError(error)) throw error;
    throw new Error(formatApiError(error), { cause: error });
  }

  if (!response.ok) {
    throw new Error(await parseApiError(response));
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

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, jsonInit("POST", body));
}

export async function putJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, jsonInit("PUT", body));
}
