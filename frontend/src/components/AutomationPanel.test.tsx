import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SystemSpecs } from "../types";
import { AutomationPanel } from "./AutomationPanel";

const mockSystemSpecs: SystemSpecs = {
  cpu_name: "Intel Core i7-12700K 12-Core Processor",
  cpu_cores: 16,
  memory_total_bytes: 32 * 1024 ** 3,
  memory_available_bytes: 24 * 1024 ** 3,
  gpu_name: "NVIDIA GeForce RTX 3080",
  gpu_memory_bytes: 10 * 1024 ** 3,
  gpu_available: true,
};

vi.mock("../hooks/useSystemSpecs", () => ({
  useSystemSpecs: () => mockSystemSpecs,
}));

const mockToggleSpecs = vi.fn();
let mockShowSpecs = false;

vi.mock("../hooks/useAutomationSpecsVisible", () => ({
  useAutomationSpecsVisible: () => ({
    showSpecs: mockShowSpecs,
    setShowSpecs: vi.fn((value: boolean) => {
      mockShowSpecs = value;
    }),
    toggleSpecs: mockToggleSpecs.mockImplementation(() => {
      mockShowSpecs = !mockShowSpecs;
    }),
  }),
}));

const baseProps = {
  filteredItems: [],
  job: null,
  startingAutoCaption: false,
  startingBodyParts: false,
  startingStripMetadata: false,
  startingSetCaptions: false,
  startingVerifyCaptions: false,
  startingBatchRename: false,
  canStart: false,
  hasSyspromptFile: false,
  hasSyspromptContent: false,
  onEditSysprompt: vi.fn(),
  onStartAutoCaption: vi.fn(),
  onStartBodyParts: vi.fn(),
  onStartStripMetadata: vi.fn(),
  onStartSetCaptions: vi.fn(),
  onStartVerifyCaptions: vi.fn(),
  onStartBatchRename: vi.fn(),
  onCancelJob: vi.fn(),
};

describe("AutomationPanel", () => {
  it("renders the panel even when no jobs can be started", () => {
    mockShowSpecs = false;
    render(<AutomationPanel {...baseProps} />);

    expect(screen.getByLabelText("Automation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create instructions" })).toBeInTheDocument();
  });

  it("shows a yellow resolve button when the folder has issue files", async () => {
    mockShowSpecs = false;
    const user = userEvent.setup();
    const onResolveIssues = vi.fn();

    render(<AutomationPanel {...baseProps} issueCount={3} onResolveIssues={onResolveIssues} />);

    const button = screen.getByRole("button", { name: "Resolve 3 caption issues" });
    expect(button).toHaveClass("automation__resolve-issues");

    await user.click(button);
    expect(onResolveIssues).toHaveBeenCalledTimes(1);
  });

  it("hides the resolve button when there are no issues", () => {
    mockShowSpecs = false;
    render(<AutomationPanel {...baseProps} issueCount={0} onResolveIssues={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Resolve/i })).not.toBeInTheDocument();
  });

  it("shows system specs when available", async () => {
    mockShowSpecs = false;
    const user = userEvent.setup();

    const { rerender } = render(
      <AutomationPanel {...baseProps} issueCount={3} onResolveIssues={vi.fn()} />,
    );

    const button = screen.getByLabelText("Toggle system specifications");
    expect(
      screen.getByLabelText("System specifications").closest(".automation__specs-panel"),
    ).not.toHaveClass("automation__specs-panel--open");

    await user.click(button);
    expect(mockToggleSpecs).toHaveBeenCalledTimes(1);

    rerender(<AutomationPanel {...baseProps} issueCount={3} onResolveIssues={vi.fn()} />);

    const specs = screen.getByLabelText("System specifications");
    expect(specs.closest(".automation__specs-panel")).toHaveClass("automation__specs-panel--open");
    expect(specs).toHaveTextContent("Intel Core i7-12700K");
    expect(specs).toHaveTextContent("16 cores");
    expect(specs).toHaveTextContent("RAM 24 GB");
    expect(specs).toHaveTextContent("32 GB");
    expect(specs).toHaveTextContent("NVIDIA GeForce RTX 3080");
    expect(specs).toHaveTextContent("10 GB");
  });
});
