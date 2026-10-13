import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listVideoProjects } from "@/features/videoEditor/api/videoProjects";

/** Prefix of every folder's draft list, for invalidating them all at once. */
export const VIDEO_PROJECTS_QUERY_KEY = ["video-projects"] as const;

/**
 * The drafts saved in ``folder``; shared by the gallery section and the editor's Projects tab.
 * Drafts count toward the folder fingerprint, so a new one re-reads the list: that is how a draft
 * added or deleted outside the app shows up.
 */
export function useVideoProjectList(
  folder: string | undefined,
  enabled = true,
  fingerprint?: string,
) {
  const queryClient = useQueryClient();
  const queryKey = [...VIDEO_PROJECTS_QUERY_KEY, folder];
  const seen = useRef({ folder, fingerprint });

  useEffect(() => {
    const previous = seen.current;
    seen.current = { folder, fingerprint };
    if (previous.folder !== folder || previous.fingerprint === fingerprint) return;
    void queryClient.invalidateQueries({
      queryKey: [...VIDEO_PROJECTS_QUERY_KEY, folder],
      exact: true,
    });
  }, [queryClient, folder, fingerprint]);

  return useQuery({
    queryKey,
    queryFn: async () => (await listVideoProjects(folder ?? "")).projects,
    enabled: enabled && Boolean(folder),
  });
}
