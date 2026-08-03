import { formatApiError } from "@/shared/api/http";

export function pathBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Names the first casualty and the count, since a batch can fail one file at a time. */
export function failureMessage(
  verb: string,
  failed: ReadonlyArray<{ path: string; error: unknown }>,
): string {
  const [first] = failed;
  // Moves carry the backend's `detail` string; deletes carry the thrown request error.
  const reason = typeof first.error === "string" ? first.error : formatApiError(first.error);

  if (failed.length === 1) {
    return `Could not ${verb} ${pathBaseName(first.path)}: ${reason}`;
  }

  return `Could not ${verb} ${failed.length} files. ${pathBaseName(first.path)}: ${reason}`;
}
