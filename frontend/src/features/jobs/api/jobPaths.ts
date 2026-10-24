export type JobStartPaths = {
  paths?: string[];
};

/**
 * Only `undefined` means the whole folder. An empty list is sent as it is, so the server refuses
 * it rather than this widening "nothing selected" into "everything".
 */
export function withJobPaths<T extends object>(body: T, paths?: string[]): T & JobStartPaths {
  if (paths === undefined) {
    return body;
  }
  return { ...body, paths };
}
