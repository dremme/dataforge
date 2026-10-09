import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND_UNREACHABLE, NetworkError, requestJson } from "@/shared/api/http";
import { useOptionalStreamConnected } from "@/shared/events/serverEvents";
import { iconCircleAlert } from "@/shared/icons";
import type { HealthResponse } from "@/shared/types";
import { EmptyState } from "@/shared/ui/EmptyState";

export const HEALTH_POLL_MS = 2_000;

function isUnreachable(error: unknown): boolean {
  return error instanceof NetworkError;
}

/** Covers the whole app while the API does not answer, and lifts once it does. */
export function BackendUnavailable() {
  const queryClient = useQueryClient();
  const connected = useOptionalStreamConnected();
  const { error, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => requestJson<HealthResponse>("/api/health", { signal }),
    // Two quick retries ride out a blip without leaving a dead app on screen for long.
    retry: (failureCount, failure) => isUnreachable(failure) && failureCount < 2,
    refetchInterval: (query) => (isUnreachable(query.state.error) ? HEALTH_POLL_MS : false),
  });

  // The event stream is the first to notice the API going away or coming back.
  const lastConnectedRef = useRef(connected);
  useEffect(() => {
    if (lastConnectedRef.current === connected) return;
    lastConnectedRef.current = connected;
    void refetch();
  }, [connected, refetch]);

  const down = isUnreachable(error);

  // Views show nothing for an unreachable backend, so whatever failed that way must be re-read
  // once it answers; the push stream may reconnect later than this probe.
  const wasDownRef = useRef(down);
  useEffect(() => {
    if (wasDownRef.current === down) return;
    wasDownRef.current = down;
    if (down) return;
    void queryClient.invalidateQueries({ predicate: (query) => isUnreachable(query.state.error) });
  }, [down, queryClient]);

  if (!down) return null;

  return (
    <div className="backend-unavailable">
      <EmptyState
        icon={iconCircleAlert}
        title={BACKEND_UNREACHABLE.title}
        description={BACKEND_UNREACHABLE.description}
        variant="error"
        role="alert"
      />
    </div>
  );
}
