import { formatApiError } from "@/shared/api/http";

export function pathBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** An edit or revert found the file replaced outside DataForge and kept the replacement. */
export function replacedExternallyMessage(name: string): string {
  return `${name} was changed outside DataForge, so that version is now its original. The earlier original and edit settings were deleted.`;
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
