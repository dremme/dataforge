import { QueryClient, type Query, type QueryCache, type QueryKey } from "@tanstack/react-query";
import { NetworkError } from "@/shared/api/http";

export const LOAD_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2000];

export interface AppQueryMeta extends Record<string, unknown> {
  /** Kept current by server pushes, so a lossy or reconnected stream must re-read it. */
  pushFed?: boolean;
  /** How many unobserved queries sharing this key's first segment may stay cached. */
  inactiveLimit?: number;
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: AppQueryMeta;
  }
}

function retryUnreachable(failureCount: number, error: unknown): boolean {
  return error instanceof NetworkError && failureCount < LOAD_RETRY_DELAYS_MS.length;
}

function retryDelay(failureCount: number): number {
  return LOAD_RETRY_DELAYS_MS[Math.min(failureCount, LOAD_RETRY_DELAYS_MS.length - 1)];
}

function isInactive(query: Query): boolean {
  // A prefetch still in flight is about to be wanted, not left behind.
  return query.getObserversCount() === 0 && query.state.fetchStatus === "idle";
}

/** Evicts the least recently updated unobserved queries past their group's `inactiveLimit`. */
function limitInactiveQueries(cache: QueryCache): () => void {
  return cache.subscribe((event) => {
    if (event.type !== "observerRemoved" && event.type !== "updated") return;
    if (!isInactive(event.query)) return;

    const limit = event.query.meta?.inactiveLimit;
    if (limit === undefined) return;

    const group = event.query.queryKey[0];
    const inactive = cache
      .findAll({ predicate: (query) => query.queryKey[0] === group && isInactive(query) })
      .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt);

    for (const query of inactive.slice(limit)) cache.remove(query);
  });
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // The API is local: `navigator.onLine` says nothing about whether it answers.
        networkMode: "always",
        refetchOnReconnect: false,
        retry: retryUnreachable,
        retryDelay,
      },
      mutations: { networkMode: "always" },
    },
  });
  limitInactiveQueries(client.getQueryCache());
  return client;
}

/**
 * A query function that folds a fresh read into the cached copy. The cache is read only once
 * the read answers, so a push that landed while it was out survives the merge.
 */
export function mergedRead<TCached, TFresh>(
  read: (signal: AbortSignal) => Promise<TFresh>,
  merge: (cached: TCached | undefined, fresh: TFresh) => TCached,
) {
  return async ({
    client,
    queryKey,
    signal,
  }: {
    client: QueryClient;
    queryKey: QueryKey;
    signal: AbortSignal;
  }): Promise<TCached> => {
    const fresh = await read(signal);
    return merge(client.getQueryData<TCached>(queryKey), fresh);
  };
}

export function isPushFed(query: Query): boolean {
  return query.meta?.pushFed === true;
}
