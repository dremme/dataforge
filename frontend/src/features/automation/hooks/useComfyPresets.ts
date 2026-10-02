import { useQuery } from "@tanstack/react-query";
import { comfyPresetsQueryOptions } from "@/features/automation/lib/automationQueries";

export function useComfyPresetsAvailable(): boolean {
  const { data } = useQuery(comfyPresetsQueryOptions());
  return (data?.presets.length ?? 0) > 0;
}
