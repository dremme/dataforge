import { postJson, requestJson } from "@/shared/api/http";
import type {
  DuplicateDismissRequest,
  DuplicateDismissResponse,
  DuplicateGroupsResponse,
  DuplicateResolveRequest,
  DuplicateResolveResponse,
} from "@/shared/types";

export async function fetchDuplicateGroups(folder: string): Promise<DuplicateGroupsResponse> {
  const params = new URLSearchParams({ folder });
  return requestJson<DuplicateGroupsResponse>(`/api/duplicates?${params}`);
}

export async function resolveDuplicateGroup(
  keep: string,
  discard: string[],
): Promise<DuplicateResolveResponse> {
  const body: DuplicateResolveRequest = { keep, discard };
  return postJson<DuplicateResolveResponse>("/api/duplicates/resolve", body);
}

/** Clears a group's findings without touching the media - a false positive. */
export async function dismissDuplicateGroup(paths: string[]): Promise<DuplicateDismissResponse> {
  const body: DuplicateDismissRequest = { paths };
  return postJson<DuplicateDismissResponse>("/api/duplicates/dismiss", body);
}
