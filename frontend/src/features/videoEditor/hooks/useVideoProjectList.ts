import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAllVideoProjects, listVideoProjects } from "@/features/videoEditor/api/videoProjects";

/** Prefix of every draft list, for invalidating them all at once. */
export const VIDEO_PROJECTS_QUERY_KEY = ["video-projects"] as const;

/** Drafts from every folder, for the editor's Projects tab; re-read each time the tab shows. */
export function useAllVideoProjects() {
  return useQuery({
    queryKey: [...VIDEO_PROJECTS_QUERY_KEY, "all"],
    queryFn: async () => (await listAllVideoProjects()).projects,
  });
}

/**
 * The drafts saved in ``folder``, for the gallery's Video projects section.
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
