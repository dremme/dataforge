import type { MediaDeleteResponse } from "@/shared/types";
import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";

/** Deletes whose media went but some related file stayed, such as a caption another app held. */
export function withLeftovers(responses: readonly MediaDeleteResponse[]): MediaDeleteResponse[] {
  return responses.filter((response) => response.retained.length > 0);
}

/** Names what stayed behind; the media itself is gone, so a plain failure would mislead. */
export function leftoversMessage(leftovers: readonly MediaDeleteResponse[]): string {
  const names = leftovers.flatMap((response) =>
    response.retained.map((file) => pathBaseName(file.path)),
  );
  if (leftovers.length === 1) {
    const [only] = leftovers;
    const kept = names.length === 1 ? names[0] : `${names.length} related files`;
    return `Deleted ${pathBaseName(only.path)}, but ${kept} could not be removed.`;
  }
  return `Deleted ${leftovers.length} files, but ${names.length} related files could not be removed.`;
}
