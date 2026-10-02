import { describe, expect, it } from "vitest";
import { job } from "@/test/fixtures";
import type { Job, JobsResponse } from "@/shared/types";
import {
  EMPTY_LIVE_JOBS,
  PENDING_REMOVAL_REVISION,
  mergeJobsListing,
  newerExternalJobs,
  removeJobs,
  upsertByRevision,
  type LiveJobs,
} from "./jobsCache";

function listing(jobs: Job[], revision: number): JobsResponse {
  return { jobs, revision, active_count: 0, total: jobs.length };
}

function live(jobs: Job[], revision = 0, removed: Record<string, number> = {}): LiveJobs {
  return { jobs, revision, removed };
}

const ids = (state: LiveJobs) => state.jobs.map((entry) => `${entry.id}@${entry.revision}`);

describe("upsertByRevision", () => {
  it("adds an unknown job in front", () => {
    const next = upsertByRevision(live([job({ id: "a" })]), job({ id: "b", revision: 2 }));

    expect(ids(next)).toEqual(["b@2", "a@1"]);
  });

  it("replaces a job only with a newer copy", () => {
    const state = live([job({ id: "a", revision: 5, processed: 5 })]);

    expect(upsertByRevision(state, job({ id: "a", revision: 4 }))).toBe(state);
    expect(upsertByRevision(state, job({ id: "a", revision: 5 }))).toBe(state);
    expect(
      upsertByRevision(state, job({ id: "a", revision: 6, processed: 6 })).jobs[0].processed,
    ).toBe(6);
  });

  it("does not bring back a job deleted after the frame was stamped", () => {
    const state = live([], 0, { a: 10 });

    expect(upsertByRevision(state, job({ id: "a", revision: 9 }))).toBe(state);
  });
});

describe("mergeJobsListing", () => {
  it("adopts a first listing as is", () => {
    const next = mergeJobsListing(undefined, listing([job({ id: "a" })], 10));

    expect(ids(next)).toEqual(["a@1"]);
    expect(next.revision).toBe(10);
  });

  it("keeps a job pushed while the listing was in flight", () => {
    const pushed = live([job({ id: "a", revision: 12, status: "completed" })], 5);

    const next = mergeJobsListing(pushed, listing([job({ id: "a", revision: 8 })], 10));

    expect(next.jobs[0]).toMatchObject({ revision: 12, status: "completed" });
  });

  it("takes the listed copy when it is the newer one", () => {
    const next = mergeJobsListing(
      live([job({ id: "a", revision: 3 })], 2),
      listing([job({ id: "a", revision: 8 })], 10),
    );

    expect(ids(next)).toEqual(["a@8"]);
  });

  it("drops a cached job the listing lacks when the listing is newer than it", () => {
    const next = mergeJobsListing(live([job({ id: "gone", revision: 3 })], 2), listing([], 10));

    expect(next.jobs).toEqual([]);
  });

  it("keeps a job created after the listing was read", () => {
    const next = mergeJobsListing(
      live([job({ id: "new", revision: 11 })], 2),
      listing([job({ id: "a", revision: 4 })], 10),
    );

    expect(ids(next)).toEqual(["new@11", "a@4"]);
  });

  it("ignores a listing no newer than one already merged", () => {
    const state = live([job({ id: "latest", revision: 20 })], 30);

    expect(mergeJobsListing(state, listing([job({ id: "stale" })], 25))).toBe(state);
  });

  it("hides a job deleted after the listing was read, until a listing stops showing it", () => {
    const state = live([], 2, { a: 15 });

    const stale = mergeJobsListing(state, listing([job({ id: "a", revision: 4 })], 10));
    expect(stale.jobs).toEqual([]);
    expect(stale.removed).toEqual({ a: 15 });

    const fresh = mergeJobsListing(stale, listing([], 20));
    expect(fresh.removed).toEqual({});
  });

  it("holds an optimistic delete against any listing that still shows the job", () => {
    const state = removeJobs(live([job({ id: "a" })], 2), ["a"], PENDING_REMOVAL_REVISION);

    expect(mergeJobsListing(state, listing([job({ id: "a" })], 99)).jobs).toEqual([]);
  });
});

describe("removeJobs", () => {
  it("drops the jobs and records when they went", () => {
    const next = removeJobs(live([job({ id: "a" }), job({ id: "b" })]), ["a", "x"], 7);

    expect(ids(next)).toEqual(["b@1"]);
    expect(next.removed).toEqual({ a: 7, x: 7 });
  });

  it("works on an empty cache", () => {
    expect(removeJobs(undefined, ["a"], 7)).toEqual({ ...EMPTY_LIVE_JOBS, removed: { a: 7 } });
  });
});

describe("newerExternalJobs", () => {
  const snapshot = (revision: number) => ({ jobs: [], active_count: 0, available: true, revision });

  it("keeps the cached snapshot unless the fresh one is newer", () => {
    const cached = snapshot(5);

    expect(newerExternalJobs(cached, snapshot(4))).toBe(cached);
    expect(newerExternalJobs(cached, snapshot(5))).toBe(cached);
    expect(newerExternalJobs(cached, snapshot(6)).revision).toBe(6);
    expect(newerExternalJobs(undefined, snapshot(1)).revision).toBe(1);
  });
});
