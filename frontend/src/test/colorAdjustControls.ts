import { vi } from "vitest";
import { RESTING_ADJUST } from "@/features/gallery/lib/colorAdjust";
import type { ColorAdjustControls } from "@/features/gallery/hooks/useColorAdjust";

export function makeAdjustControls(
  overrides: Partial<ColorAdjustControls> = {},
): ColorAdjustControls {
  return {
    values: { ...RESTING_ADJUST },
    auto: null,
    autoPending: false,
    active: false,
    comparing: false,
    zoomed: false,
    previewAvailable: true,
    setActive: vi.fn(),
    setComparing: vi.fn(),
    setZoomed: vi.fn(),
    setPreviewAvailable: vi.fn(),
    set: vi.fn(),
    reset: vi.fn(),
    cancelAuto: vi.fn(),
    activateAuto: vi.fn(),
    deactivateAuto: vi.fn(),
    setAutoAmount: vi.fn(),
    ...overrides,
  };
}
