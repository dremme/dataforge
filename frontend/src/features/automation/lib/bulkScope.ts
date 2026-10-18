import type { ModalScopeInfo } from "@/shared/ui/ModalScope";

export type BulkScopeKind = "selected" | "visible" | "folder";

export interface BulkScopeSnapshot {
  scope: ModalScopeInfo;
  paths: string[] | undefined;
}

export function snapshotBulkScope(scope: ModalScopeInfo, paths?: string[]): BulkScopeSnapshot {
  return { scope: { ...scope }, paths: paths ? [...paths] : undefined };
}
