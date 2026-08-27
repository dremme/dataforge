import { describe, expect, it } from "vitest";
import { isServerEvent } from "@/shared/wireGuards";
import { job } from "@/test/fixtures";

/** Generated guards: a non-job `/api/events` frame must not reach setExternalJobs as undefined. */
describe("isServerEvent", () => {
  const jobEvent = { type: "job", job: job() };
  const externalEvent = { type: "external_jobs", jobs: [], active_count: 0, available: true };

  it("accepts the frames the backend publishes", () => {
    expect(isServerEvent(jobEvent)).toBe(true);
    expect(isServerEvent(externalEvent)).toBe(true);
  });

  it("accepts a nullable field whether it is null or absent", () => {
    expect(isServerEvent({ type: "job", job: { ...job(), error: null } })).toBe(true);
    const { error: _error, ...withoutError } = job();
    expect(isServerEvent({ type: "job", job: withoutError })).toBe(true);
  });

  it("keeps a job type retired since the row was written", () => {
    // The backend serves job_type as a bare str for exactly this reason, so rejecting
    // the frame would lose a real job rather than tolerate an old label.
    expect(isServerEvent({ type: "job", job: { ...job(), job_type: "retired_type" } })).toBe(true);
  });

  it.each([
    ["an unknown event type", { type: "banana" }],
    ["a missing required field", { type: "job", job: { ...job(), id: undefined } }],
    ["a nested value of the wrong type", { type: "job", job: 42 }],
    ["a wrongly typed nullable field", { type: "job", job: { ...job(), error: 5 } }],
    ["a null where a number belongs", { type: "job", job: { ...job(), total: null } }],
    ["a stats map holding a string", { type: "job", job: { ...job(), stats: { done: "1" } } }],
    ["a non-array jobs list", { ...externalEvent, jobs: {} }],
    ["a malformed entry inside jobs", { ...externalEvent, jobs: [{ id: "a" }] }],
    ["null", null],
    ["an array", []],
  ])("rejects %s", (_label, frame) => {
    expect(isServerEvent(frame)).toBe(false);
  });
});
