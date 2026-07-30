import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemSpecs } from "@/shared/types";
import { AutomationSystemSpecs } from "./AutomationSystemSpecs";

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

let mockSystemSpecs: SystemSpecs | null = defaultSystemSpecs;

vi.mock("@/features/automation/hooks/useSystemSpecs", () => ({
  useSystemSpecs: () => mockSystemSpecs,
}));

function renderSpecs(open = true) {
  return render(<AutomationSystemSpecs id="specs-panel" open={open} />);
}

describe("AutomationSystemSpecs", () => {
  beforeEach(() => {
    mockSystemSpecs = defaultSystemSpecs;
  });

  it("renders the CPU, RAM and GPU readouts", () => {
    renderSpecs();

    const specs = screen.getByLabelText("System specifications");
    expect(specs).toHaveTextContent("Intel Core i7-12700K");
    expect(specs).toHaveTextContent("16 cores");
    expect(specs).toHaveTextContent("RAM");
    // Both readouts are used / total (matching Task Manager), never free / total,
    // and the unit is written once, after the total.
    expect(specs).toHaveTextContent("8 / 32 GB");
    expect(specs).toHaveTextContent("NVIDIA GeForce RTX 3080");
    expect(specs).toHaveTextContent("4 / 10 GB");
  });

  it("opens the panel and keeps the toggle's aria-controls target", () => {
    const { container, rerender } = renderSpecs(false);

    const panel = container.querySelector("#specs-panel");
    expect(panel).toHaveClass("automation__specs-panel");
    expect(panel).not.toHaveClass("automation__specs-panel--open");

    rerender(<AutomationSystemSpecs id="specs-panel" open />);
    expect(container.querySelector("#specs-panel")).toHaveClass("automation__specs-panel--open");
  });

  it("warns on the used figure when RAM and VRAM are nearly full", () => {
    mockSystemSpecs = {
      ...defaultSystemSpecs,
      memory_used_bytes: 30 * 1024 ** 3, // 30 of 32 GB used
      gpu_memory_used_bytes: 9 * 1024 ** 3, // 9 of 10 GB used
    };

    const { container } = renderSpecs();

    const warned = [...container.querySelectorAll(".automation__spec-detail--warning")].map(
      (node) => node.textContent,
    );
    // Only the used figures are highlighted — the totals keep their unit and normal colour.
    expect(warned).toEqual(["30", "9"]);
  });

  it("leaves the memory figures unhighlighted below the warning threshold", () => {
    const { container } = renderSpecs();

    expect(container.querySelector(".automation__spec-detail--warning")).toBeNull();
  });

  it("shows the VRAM total alone when usage is unknown", () => {
    mockSystemSpecs = {
      ...defaultSystemSpecs,
      gpu_memory_used_bytes: null,
    };

    renderSpecs();

    const specs = screen.getByLabelText("System specifications");
    expect(specs).toHaveTextContent("NVIDIA GeForce RTX 3080 · 10 GB");
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
