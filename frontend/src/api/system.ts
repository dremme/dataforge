import { requestJson } from "./http";
import type { SystemSpecs } from "../types";

export function fetchSystemSpecs(): Promise<SystemSpecs> {
  return requestJson<SystemSpecs>("/api/system/specs");
}
