import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobsButton } from "./JobsButton";

const jobsContext = {
  activeCount: 0,
  drawerOpen: false,
  toggleDrawer: vi.fn(),
  unseenCount: 0,
  unseenFailed: false,
};

vi.mock("@/features/jobs/context/JobsContext", () => ({
  useJobs: () => jobsContext,
}));

beforeEach(() => {
  Object.assign(jobsContext, { activeCount: 0, unseenCount: 0, unseenFailed: false });
});

describe("JobsButton", () => {
  it("shows no count when every finished job has been seen", () => {
    const { container } = render(<JobsButton />);

    expect(screen.getByRole("button", { name: "Open automation jobs" })).toBeInTheDocument();
    expect(container.querySelector(".jobs-button__count")).toBeNull();
  });

  it("counts jobs that finished while nobody was looking", () => {
    jobsContext.unseenCount = 3;
    const { container } = render(<JobsButton />);

    expect(
      screen.getByRole("button", { name: "Open automation jobs (3 new)" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".jobs-button__count")).toHaveTextContent("3");
    expect(container.querySelector(".jobs-button__count--danger")).toBeNull();
  });

  it("turns the count red when an unseen job failed", () => {
    Object.assign(jobsContext, { activeCount: 1, unseenCount: 1, unseenFailed: true });
    const { container } = render(<JobsButton />);

    expect(
      screen.getByRole("button", { name: "Open automation jobs (running, 1 new, some failed)" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".jobs-button__count--danger")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /running/ })).toHaveClass("jobs-button--running");
    expect(container.querySelector(".jobs-button__dot")).toBeNull();
    expect(container.querySelectorAll(".jobs-button__count")).toHaveLength(1);
  });
});
