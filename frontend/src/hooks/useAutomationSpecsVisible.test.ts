import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as uiPreferences from "../uiPreferences";
import { useAutomationSpecsVisible } from "./useAutomationSpecsVisible";

describe("useAutomationSpecsVisible", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the saved preference from ui settings", async () => {
    vi.spyOn(uiPreferences, "readCachedAutomationSpecsPreference").mockReturnValue(false);
    vi.spyOn(uiPreferences, "loadUiSettings").mockResolvedValue({
      sort: "name-asc",
      showAutomationSpecs: true,
    });

    const { result } = renderHook(() => useAutomationSpecsVisible());

    await waitFor(() => {
      expect(result.current.showSpecs).toBe(true);
    });
  });

  it("persists when toggled", async () => {
    vi.spyOn(uiPreferences, "readCachedAutomationSpecsPreference").mockReturnValue(false);
    vi.spyOn(uiPreferences, "loadUiSettings").mockResolvedValue({
      sort: "name-asc",
      showAutomationSpecs: false,
    });
    const updateUiSettings = vi
      .spyOn(uiPreferences, "updateUiSettings")
      .mockResolvedValue({ sort: "name-asc", showAutomationSpecs: true });

    const { result } = renderHook(() => useAutomationSpecsVisible());

    await waitFor(() => {
      expect(result.current.showSpecs).toBe(false);
    });

    act(() => {
      result.current.toggleSpecs();
    });

    expect(result.current.showSpecs).toBe(true);
    expect(updateUiSettings).toHaveBeenCalledWith({ showAutomationSpecs: true });
  });
});
