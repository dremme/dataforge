import { useQuery } from "@tanstack/react-query";
import { listVideoProjectFonts } from "@/features/videoEditor/api/videoProjects";

/** The installed families, read once per session: fonts are rarely installed mid-edit. */
export function useFontFamilies() {
  return useQuery({
    queryKey: ["video-project-fonts"],
    queryFn: async () => (await listVideoProjectFonts()).families,
    staleTime: Infinity,
  });
}
