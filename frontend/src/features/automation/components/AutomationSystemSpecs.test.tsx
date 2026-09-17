import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemSpecs } from "@/shared/types";
import { AutomationSystemSpecs } from "./AutomationSystemSpecs";

const defaultSystemSpecs: SystemSpecs = {
  cpu_name: "Intel Core i7-12700K 12-Core Processor",
  cpu_cores: 16,
  cpu_usage_percent: 37.6,
  memory_total_bytes: 32 * 1024 ** 3,
  memory_used_bytes: 8 * 1024 ** 3,
  gpu_name: "NVIDIA GeForce RTX 3080",
  gpu_memory_bytes: 10 * 1024 ** 3,
  gpu_memory_used_bytes: 4 * 1024 ** 3,
  gpu_load_percent: 91,
  gpu_available: true,
};

let mockSystemSpecs: SystemSpecs | null = defaultSystemSpecs;

const useSystemSpecsMock = vi.fn((_live?: boolean) => mockSystemSpecs);

vi.mock("@/features/automation/hooks/useSystemSpecs", () => ({
  useSystemSpecs: (live?: boolean) => useSystemSpecsMock(live),
}));

function renderSpecs(open = true, jobActive = false) {
  return render(<AutomationSystemSpecs id="specs-panel" open={open} jobActive={jobActive} />);
}

describe("AutomationSystemSpecs", () => {
  beforeEach(() => {
    mockSystemSpecs = defaultSystemSpecs;
    useSystemSpecsMock.mockClear();
  });

  it("renders the CPU, RAM and GPU readouts", () => {
    renderSpecs();

    const specs = screen.getByLabelText("System specifications");
    expect(specs).toHaveTextContent("Intel Core i7-12700K");
    expect(specs).toHaveTextContent("16 cores");
    expect(specs.querySelector('[title="CPU usage"]')).toHaveTextContent("38%");
    expect(specs).toHaveTextContent("RAM");
    // Both readouts are used / total (matching Task Manager), never free / total,
    // and the unit is written once, after the total.
    expect(specs).toHaveTextContent("8 / 32 GB");
    expect(specs).toHaveTextContent("NVIDIA GeForce RTX 3080");
    expect(specs).toHaveTextContent("4 / 10 GB");
    expect(specs.querySelector('[title="GPU load"]')).toHaveTextContent("91%");
  });

  it("draws a bar under each spec: CPU load, RAM used, GPU load", () => {
    renderSpecs();

    const value = (name: string) =>
      screen.getByRole("meter", { name }).getAttribute("aria-valuenow");
    expect(value("CPU load")).toBe("38");
    // RAM is the used share of the total (8 of 32 GB), not a load figure.
    expect(value("RAM usage")).toBe("25");
    // GPU is load, not VRAM (4 of 10 GB would be 40).
    expect(value("GPU load")).toBe("91");
  });

  it("keeps an empty track where a figure is unknown so the bars stay aligned", () => {
    mockSystemSpecs = { ...defaultSystemSpecs, cpu_usage_percent: null, gpu_load_percent: null };

    const { container } = renderSpecs();

    expect(screen.getAllByRole("meter").map((meter) => meter.getAttribute("aria-label"))).toEqual([
      "RAM usage",
    ]);
    expect(container.querySelectorAll(".automation__spec-meter")).toHaveLength(3);
  });

  it("hides the CPU usage when the backend cannot read it", () => {
    mockSystemSpecs = { ...defaultSystemSpecs, cpu_usage_percent: null };

    renderSpecs();

    expect(
      screen.getByLabelText("System specifications").querySelector('[title="CPU usage"]'),
    ).toBeNull();
  });

  it("polls live only while a job runs and the panel is open", () => {
    const { rerender } = renderSpecs(true, false);
    expect(useSystemSpecsMock).toHaveBeenLastCalledWith(false);

    rerender(<AutomationSystemSpecs id="specs-panel" open jobActive />);
    expect(useSystemSpecsMock).toHaveBeenLastCalledWith(true);

    rerender(<AutomationSystemSpecs id="specs-panel" open={false} jobActive />);
    expect(useSystemSpecsMock).toHaveBeenLastCalledWith(false);
  });

  it("opens the panel and keeps the toggle's aria-controls target", () => {
    const { container, rerender } = renderSpecs(false);

    const panel = container.querySelector("#specs-panel");
    expect(panel).toHaveClass("automation__specs-panel");
    expect(panel).not.toHaveClass("automation__specs-panel--open");

    rerender(<AutomationSystemSpecs id="specs-panel" open />);
    expect(container.querySelector("#specs-panel")).toHaveClass("automation__specs-panel--open");
  });

  it("colours figures and bars yellow from 75% and red from 90%", () => {
    mockSystemSpecs = {
      ...defaultSystemSpecs,
      cpu_usage_percent: 74.4, // just under: rounds to 74, stays normal
      memory_used_bytes: 24 * 1024 ** 3, // 24 of 32 GB = 75%
      gpu_memory_used_bytes: 9 * 1024 ** 3, // 9 of 10 GB = 90%
      gpu_load_percent: 80,
    };

    const { container } = renderSpecs();

    const figures = (level: string) =>
      [...container.querySelectorAll(`.automation__spec-detail--${level}`)].map(
        (node) => node.textContent,
      );
    // Only the used figures are coloured � the totals keep their unit and normal colour.
    expect(figures("warning")).toEqual(["24", "80%"]);
    expect(figures("danger")).toEqual(["9"]);

    const fill = (name: string) => screen.getByRole("meter", { name }).firstElementChild;
    expect(fill("CPU load")?.className).toBe("automation__spec-meter-fill");
    expect(fill("RAM usage")).toHaveClass("automation__spec-meter-fill--warning");
    expect(fill("GPU load")).toHaveClass("automation__spec-meter-fill--warning");
  });

  it("turns the load red at 90%", () => {
    mockSystemSpecs = { ...defaultSystemSpecs, cpu_usage_percent: 90, gpu_load_percent: 100 };

    renderSpecs();

    const specs = screen.getByLabelText("System specifications");
    expect(
      specs.querySelector('[title="CPU usage"] .automation__spec-detail--danger'),
    ).toHaveTextContent("90%");
    expect(
      specs.querySelector('[title="GPU load"] .automation__spec-detail--danger'),
    ).toHaveTextContent("100%");
    expect(screen.getByRole("meter", { name: "CPU load" }).firstElementChild).toHaveClass(
      "automation__spec-meter-fill--danger",
    );
    expect(screen.getByRole("meter", { name: "GPU load" }).firstElementChild).toHaveClass(
      "automation__spec-meter-fill--danger",
    );
  });

  it("leaves figures and bars uncoloured below the warning threshold", () => {
    mockSystemSpecs = { ...defaultSystemSpecs, gpu_load_percent: 12 };

    const { container } = renderSpecs();

    expect(container.querySelector('[class*="--warning"], [class*="--danger"]')).toBeNull();
  });

  it("shows the VRAM total alone when usage is unknown", () => {
    mockSystemSpecs = {
      ...defaultSystemSpecs,
      gpu_memory_used_bytes: null,
    };

    renderSpecs();

    const specs = screen.getByLabelText("System specifications");
    expect(specs).toHaveTextContent("NVIDIA GeForce RTX 3080");
    expect(specs.querySelector('[title="VRAM total"]')).toHaveTextContent("10 GB");
  });

  it("falls back to No GPU when none is available", () => {
    mockSystemSpecs = { ...defaultSystemSpecs, gpu_available: false };

    renderSpecs();

    expect(screen.getByLabelText("System specifications")).toHaveTextContent("No GPU");
  });

  it("renders nothing until the specs load", () => {
    mockSystemSpecs = null;

    const { container } = renderSpecs();

    expect(container).toBeEmptyDOMElement();
  });
});
