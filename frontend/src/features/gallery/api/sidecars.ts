import { postJson } from "@/shared/api/http";
import type { SidecarDeleteRequest, SidecarDeleteResponse, SidecarKind } from "@/shared/types";

export async function deleteSidecars(
  folder: string,
  kind: SidecarKind,
): Promise<SidecarDeleteResponse> {
  const body: SidecarDeleteRequest = { folder, kind };
  return postJson<SidecarDeleteResponse>("/api/sidecars/delete", body);
}
