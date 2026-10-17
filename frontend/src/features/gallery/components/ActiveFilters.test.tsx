import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActiveFilters } from "./ActiveFilters";
import type { FileFilter, ItemFilter, MediaTypeFilter } from "@/features/gallery/lib/query";

function renderFilters() {
  const handlers = {
    onFilterChange: vi.fn<(value: ItemFilter) => void>(),
    onMediaTypeFilterChange: vi.fn<(value: MediaTypeFilter) => void>(),
    onFileFilterChange: vi.fn<(value: FileFilter) => void>(),
  };
  render(
    <ActiveFilters filter="captioned" mediaTypeFilter="video" fileFilter="edited" {...handlers} />,
  );
  return handlers;
}

describe("ActiveFilters", () => {
  it.each([
    ["Remove caption filter", "onFilterChange"],
    ["Remove media type filter", "onMediaTypeFilterChange"],
    ["Remove file filter", "onFileFilterChange"],
  ] as const)("%s resets only that filter", async (name, handler) => {
    const user = userEvent.setup();
    const handlers = renderFilters();

    await user.click(screen.getByRole("button", { name }));

    const calls = Object.fromEntries(
      Object.entries(handlers).map(([key, mock]) => [key, mock.mock.calls]),
    );
    expect(calls).toEqual({
      onFilterChange: [],
      onMediaTypeFilterChange: [],
      onFileFilterChange: [],
      [handler]: [["all"]],
    });
  });
});
