export type JobStartPaths = {
  paths?: string[];
};

export function withJobPaths<T extends object>(body: T, paths?: string[]): T & JobStartPaths {
  if (!paths || paths.length === 0) {
    return body;
  }
  return { ...body, paths };
}
