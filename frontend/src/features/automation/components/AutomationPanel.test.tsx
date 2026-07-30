import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GalleryItem, Job, SystemSpecs } from "@/shared/types";
import { AutomationPanel } from "./AutomationPanel";

const finishedJob: Job = {
  id: "job-1",
  folder: "C:\\Photos",
  folder_name: "Photos",
  job_type: "auto_caption",
  status: "completed",
  total: 10,
  processed: 10,
  current_file: null,
  current_name: null,
  stats: { success: 10 },
  results: [],
  error: null,
  created_at: "2026-01-01T12:00:00.000Z",
  started_at: "2026-01-01T12:00:00.000Z",
  finished_at: "2026-01-01T12:02:30.000Z",
};

const galleryItem: GalleryItem = {
  name: "sunset.png",
  path: "C:\\Photos\\sunset.png",
  description: null,
  has_description: false,
  has_caption_file: false,
  has_bboxes: false,
  issue: null,
  issue_suggestions: null,
  has_issue_file: false,
  caption_status: "none",
  caption_file_type: null,
  media_type: "image",
  width: 1920,
  height: 1080,
};

const defaultSystemSpecs: SystemSpecs = {
  cpu_name: "Intel Core i7-12700K 12-Core Processor",
  cpu_cores: 16,
  memory_total_bytes: 32 * 1024 ** 3,
  memory_used_bytes: 8 * 1024 ** 3,
  gpu_name: "NVIDIA GeForce RTX 3080",
  gpu_memory_bytes: 10 * 1024 ** 3,
  gpu_memory_used_bytes: 4 * 1024 ** 3,
  gpu_available: true,
};

vi.mock("@/features/automation/hooks/useSystemSpecs", () => ({
  useSystemSpecs: () => defaultSystemSpecs,
}));

const mockToggleSpecs = vi.fn();
let mockShowSpecs = false;

vi.mock("@/features/automation/hooks/useAutomationSpecsVisible", () => ({
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
  startingJobType: null,
  canStart: false,
  hasSyspromptFile: false,
  hasSyspromptContent: false,
  jobAvailability: { hasCaptionBackup: false },
  onEditSysprompt: vi.fn(),
  onRequestStart: vi.fn(),
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

  it("shows how long a finished job took next to the counts", () => {
    mockShowSpecs = false;
    const { container } = render(<AutomationPanel {...baseProps} job={finishedJob} />);

    expect(container.querySelector(".automation__counts")).toHaveTextContent(
      "10/10 · Took 2 min 30s",
    );
  });

  it("shows the time taken for a cancelled job", () => {
    mockShowSpecs = false;
    const cancelledJob: Job = {
      ...finishedJob,
      status: "cancelled",
      processed: 4,
      stats: { success: 4 },
      finished_at: "2026-01-01T12:00:20.000Z",
    };

    const { container } = render(<AutomationPanel {...baseProps} job={cancelledJob} />);

    expect(container.querySelector(".automation__remaining")).toHaveTextContent("Took 20s");
  });

  it("toggles the system specs panel it controls", async () => {
    mockShowSpecs = false;
    const user = userEvent.setup();

    const { rerender } = render(<AutomationPanel {...baseProps} />);

    const button = screen.getByLabelText("Toggle system specifications");
    const panelId = button.getAttribute("aria-controls");
    const specsPanel = screen
      .getByLabelText("System specifications")
      .closest(".automation__specs-panel");
    expect(specsPanel).toHaveAttribute("id", panelId);
    expect(specsPanel).not.toHaveClass("automation__specs-panel--open");
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    expect(mockToggleSpecs).toHaveBeenCalledTimes(1);

    rerender(<AutomationPanel {...baseProps} />);

    expect(
      screen.getByLabelText("System specifications").closest(".automation__specs-panel"),
    ).toHaveClass("automation__specs-panel--open");
    expect(screen.getByLabelText("Toggle system specifications")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("offers caption backup and restore in the more-jobs menu", async () => {
    mockShowSpecs = false;
    const user = userEvent.setup();
    const onRequestStart = vi.fn();

    render(
      <AutomationPanel
        {...baseProps}
        canStart
        jobAvailability={{ hasCaptionBackup: true }}
        filteredItems={[galleryItem]}
        onRequestStart={onRequestStart}
      />,
    );

    await user.click(screen.getByRole("button", { name: /More/ }));

    await user.click(screen.getByRole("menuitem", { name: /Backup captions/ }));
    expect(onRequestStart).toHaveBeenCalledWith("backup_captions");

    await user.click(screen.getByRole("button", { name: /More/ }));
    await user.click(screen.getByRole("menuitem", { name: /Restore captions/ }));
    expect(onRequestStart).toHaveBeenCalledWith("restore_captions");
  });

  it("disables restore captions when the folder has no backup", async () => {
    mockShowSpecs = false;
    const user = userEvent.setup();
    const onRequestStart = vi.fn();

    render(
      <AutomationPanel
        {...baseProps}
        canStart
        jobAvailability={{ hasCaptionBackup: false }}
        filteredItems={[galleryItem]}
        onRequestStart={onRequestStart}
      />,
    );

    await user.click(screen.getByRole("button", { name: /More/ }));

    const restoreItem = screen.getByRole("menuitem", { name: /Restore captions/ });
    expect(restoreItem).toBeDisabled();

    await user.click(restoreItem);
    expect(onRequestStart).not.toHaveBeenCalled();
  });

  it("leaves backup captions startable when the folder has no backup yet", async () => {
    mockShowSpecs = false;
    const user = userEvent.setup();
    const onRequestStart = vi.fn();

    render(
      <AutomationPanel
        {...baseProps}
        canStart
        jobAvailability={{ hasCaptionBackup: false }}
        filteredItems={[galleryItem]}
        onRequestStart={onRequestStart}
      />,
    );

    await user.click(screen.getByRole("button", { name: /More/ }));

    await user.click(screen.getByRole("menuitem", { name: /Backup captions/ }));
    expect(onRequestStart).toHaveBeenCalledWith("backup_captions");
  });
});
