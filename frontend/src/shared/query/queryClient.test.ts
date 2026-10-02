import { QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/shared/api/http";
import { LOAD_RETRY_DELAYS_MS, createQueryClient, mergedRead } from "./queryClient";

afterEach(() => {
  vi.useRealTimers();
});

describe("createQueryClient retries", () => {
  it("retries an unreachable backend on the load schedule, then gives up", async () => {
    vi.useFakeTimers();
    const client = createQueryClient();
    const queryFn = vi.fn().mockRejectedValue(new NetworkError());

    const result = client.fetchQuery({ queryKey: ["down"], queryFn }).catch((error) => error);
    for (const delay of LOAD_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);

    expect(await result).toBeInstanceOf(NetworkError);
    expect(queryFn).toHaveBeenCalledTimes(LOAD_RETRY_DELAYS_MS.length + 1);
  });

  it("does not retry an answer the API gave on purpose", async () => {
    const client = createQueryClient();
    const queryFn = vi.fn().mockRejectedValue(new ApiError(404, "Folder not found"));

    await expect(client.fetchQuery({ queryKey: ["gone"], queryFn })).rejects.toThrow();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe("createQueryClient inactive limit", () => {
  function watchAndLeave(client: ReturnType<typeof createQueryClient>, key: string) {
    client.setQueryData(["folder", key], key);
    const observer = new QueryObserver(client, {
      queryKey: ["folder", key],
      enabled: false,
      meta: { inactiveLimit: 2 },
    });
    const unsubscribe = observer.subscribe(() => {});
    unsubscribe();
  }

  it("keeps only the most recently updated folders once nothing shows them", () => {
    vi.useFakeTimers();
    const client = createQueryClient();

    for (const key of ["a", "b", "c"]) {
      vi.advanceTimersByTime(1000);
      watchAndLeave(client, key);
    }

    expect(client.getQueryData(["folder", "a"])).toBeUndefined();
    expect(client.getQueryData(["folder", "b"])).toBe("b");
    expect(client.getQueryData(["folder", "c"])).toBe("c");
  });

  it("limits unobserved prefetches without evicting reads still in flight", async () => {
    vi.useFakeTimers();
    const client = createQueryClient();
    let finishPending!: (value: string) => void;
    const pending = client.prefetchQuery({
      queryKey: ["folder", "pending"],
      queryFn: () =>
        new Promise<string>((resolve) => {
          finishPending = resolve;
        }),
      meta: { inactiveLimit: 2 },
    });
    for (const key of ["a", "b", "c"]) {
      vi.advanceTimersByTime(1000);
      await client.prefetchQuery({
        queryKey: ["folder", key],
        queryFn: async () => key,
        meta: { inactiveLimit: 2 },
      });
    }
    expect(client.getQueryData(["folder", "a"])).toBeUndefined();
    expect(client.getQueryData(["folder", "b"])).toBe("b");
    expect(client.getQueryData(["folder", "c"])).toBe("c");
    expect(client.getQueryState(["folder", "pending"])?.fetchStatus).toBe("fetching");
    vi.advanceTimersByTime(1000);
    finishPending("pending");
    await pending;
    expect(client.getQueryCache().findAll({ queryKey: ["folder"] })).toHaveLength(2);
    expect(client.getQueryData(["folder", "b"])).toBeUndefined();
    expect(client.getQueryData(["folder", "pending"])).toBe("pending");
    client.clear();
  });

  it("never evicts a folder something still shows", () => {
    vi.useFakeTimers();
    const client = createQueryClient();
    client.setQueryData(["folder", "open"], "open");
    const shown = new QueryObserver(client, {
      queryKey: ["folder", "open"],
      enabled: false,
      meta: { inactiveLimit: 2 },
    });
    const unsubscribe = shown.subscribe(() => {});

    for (const key of ["a", "b", "c"]) {
      vi.advanceTimersByTime(1000);
      watchAndLeave(client, key);
    }

    expect(client.getQueryData(["folder", "open"])).toBe("open");
    unsubscribe();
  });
});

describe("mergedRead", () => {
  it("merges into what the cache holds when the read answers, not when it started", async () => {
    const client = createQueryClient();
    client.setQueryData(["merged"], ["before"]);
    let answer: (value: string) => void = () => {};
    const read = () => new Promise<string>((resolve) => (answer = resolve));

    const result = client.fetchQuery({
      queryKey: ["merged"],
      queryFn: mergedRead<string[], string>(read, (cached, fresh) => [...(cached ?? []), fresh]),
    });
    await Promise.resolve();
    client.setQueryData(["merged"], ["before", "pushed"]);
    answer("listed");

    expect(await result).toEqual(["before", "pushed", "listed"]);
  });
});
