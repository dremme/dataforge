import { postJson, requestJson } from "@/shared/api/http";
import type {
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
