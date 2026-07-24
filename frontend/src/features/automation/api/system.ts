import { requestJson } from "@/shared/api/http";
import type { SystemSpecs } from "@/shared/types";

export function fetchSystemSpecs(): Promise<SystemSpecs> {
  return requestJson<SystemSpecs>("/api/system/specs");
}
