import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComfyProcessLogs } from "@/features/automation/hooks/useComfyProcessLogs";
import { job } from "@/test/fixtures";
import { ComfyProcessLog } from "./ComfyProcessLog";

vi.mock("@/features/automation/hooks/useComfyProcessLogs", () => ({
  useComfyProcessLogs: vi.fn(),
}));

const useLogs = vi.mocked(useComfyProcessLogs);

function renderLog() {
  render(<ComfyProcessLog job={job({ job_type: "comfy_process", status: "running" })} />);
}

describe("ComfyProcessLog", () => {
  beforeEach(() => {
    useLogs.mockReset().mockReturnValue(null);
  });

  it("shows nothing at all when there is no output to show", () => {
    useLogs.mockReturnValue(null);
    const { container } = render(<ComfyProcessLog job={job()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders ComfyUI's lines", () => {
    useLogs.mockReturnValue({ lines: ["Phase 3: VAE decoding", "done"], available: true });
    renderLog();

    expect(screen.getByRole("region", { name: "ComfyUI output" })).toHaveTextContent("Phase 3");
  });

  it("says so quietly when ComfyUI will not report, without raising an alert", () => {
    // An older ComfyUI has no such endpoint; that is not a job failure and must not read as one.
    useLogs.mockReturnValue({ lines: [], available: false });
    renderLog();

    expect(screen.getByText(/not reporting its output/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits visibly before the first output arrives", () => {
    useLogs.mockReturnValue({ lines: [], available: true });
    renderLog();

    expect(screen.getByText("Waiting for ComfyUI output...")).toBeInTheDocument();
  });

  it("never announces itself to a screen reader", () => {
    // It repaints every couple of seconds, and a polite region queues rather than drops.
    useLogs.mockReturnValue({ lines: ["a", "b"], available: true });
    const { container } = render(
      <ComfyProcessLog job={job({ job_type: "comfy_process", status: "running" })} />,
    );

    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector('[role="log"]')).toBeNull();
  });

  it("folds away and back", async () => {
    const user = userEvent.setup();
    useLogs.mockReturnValue({ lines: ["Phase 3"], available: true });
    renderLog();

    const toggle = screen.getByRole("button", { name: /ComfyUI output/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "ComfyUI output" })).toBeNull();
  });
});
