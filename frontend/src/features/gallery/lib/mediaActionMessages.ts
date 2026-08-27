import { formatApiError } from "@/shared/api/http";

export function pathBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function failureMessage(
  verb: string,
  failed: ReadonlyArray<{ path: string; error: unknown }>,
): string {
  const [first] = failed;
  const reason = typeof first.error === "string" ? first.error : formatApiError(first.error);

  if (failed.length === 1) {
    return `Could not ${verb} ${pathBaseName(first.path)}: ${reason}`;
  }

  return `Could not ${verb} ${failed.length} files. ${pathBaseName(first.path)}: ${reason}`;
}
