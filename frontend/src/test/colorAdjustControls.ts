import { vi } from "vitest";
import { RESTING_ADJUST } from "@/features/gallery/lib/colorAdjust";
import type { ColorAdjustControls } from "@/features/gallery/hooks/useColorAdjust";
import type { AdjustTool } from "@/features/gallery/lib/colorAdjust";

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
    setActive: vi.fn<(active: boolean) => void>(),
    setComparing: vi.fn<(comparing: boolean) => void>(),
    setZoomed: vi.fn<(zoomed: boolean) => void>(),
    setPreviewAvailable: vi.fn<(available: boolean) => void>(),
    set: vi.fn<(tool: AdjustTool, value: number) => void>(),
    reset: vi.fn<() => void>(),
    cancelAuto: vi.fn<() => void>(),
    activateAuto: vi.fn<() => void>(),
    deactivateAuto: vi.fn<() => void>(),
    setAutoAmount: vi.fn<(amount: number) => void>(),
    ...overrides,
  };
}
