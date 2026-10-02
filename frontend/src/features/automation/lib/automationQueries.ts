import { queryOptions } from "@tanstack/react-query";
import { fetchComfyPresets } from "@/features/automation/api/jobs";
import { fetchSystemSpecs } from "@/features/automation/api/system";

/** Reads shared by more than one reader, kept with their keys so the readers cannot drift. */
export function systemSpecsQueryOptions() {
  return queryOptions({ queryKey: ["system-specs"], queryFn: fetchSystemSpecs });
}

export function comfyPresetsQueryOptions() {
  return queryOptions({
    queryKey: ["comfy-presets"],
    queryFn: ({ signal }) => fetchComfyPresets(signal),
    // An unreachable ComfyUI answers `available: false`; the backend being down is a failure
    // each reader reports at once.
    retry: false,
  });
}
