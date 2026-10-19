import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export type BulkScopeKind = "selected" | "visible" | "folder";

export interface BulkScopeSnapshot {
  scope: DialogScopeInfo;
  paths: string[] | undefined;
}

export function snapshotBulkScope(scope: DialogScopeInfo, paths?: string[]): BulkScopeSnapshot {
  return { scope: { ...scope }, paths: paths ? [...paths] : undefined };
}
