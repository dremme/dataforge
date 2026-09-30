import { AUTO_ADJUST_DEFAULT_AMOUNT } from "@/shared/constants";
import type { AutoAdjust, ColorAdjust } from "@/shared/types";
import { ADJUST_TOOL_IDS, adjustEqual, clampAdjust } from "./colorAdjust";

function share(amount: number): number {
  return amount / AUTO_ADJUST_DEFAULT_AMOUNT;
}

function shifted(adjust: ColorAdjust, suggestion: ColorAdjust, by: number): ColorAdjust {
  const next = { ...adjust };
  for (const tool of ADJUST_TOOL_IDS) {
    next[tool] = adjust[tool] + by * suggestion[tool];
  }
  return clampAdjust(next);
}

export function withAuto(
  adjust: ColorAdjust,
  suggestion: ColorAdjust,
  amount = AUTO_ADJUST_DEFAULT_AMOUNT,
): { adjust: ColorAdjust; autoAdjust: AutoAdjust } {
  return {
    adjust: shifted(adjust, suggestion, share(amount)),
    autoAdjust: { amount, suggestion, base: { ...adjust } },
  };
}

export function rescaleAuto(
  adjust: ColorAdjust,
  auto: AutoAdjust,
  amount: number,
): { adjust: ColorAdjust; autoAdjust: AutoAdjust } {
  return withAuto(withoutAuto(adjust, auto), auto.suggestion, amount);
}

export function withoutAuto(adjust: ColorAdjust, auto: AutoAdjust): ColorAdjust {
  if (!auto.base) return shifted(adjust, auto.suggestion, -share(auto.amount));
  const composed = shifted(auto.base, auto.suggestion, share(auto.amount));
  const base = { ...auto.base };
  for (const tool of ADJUST_TOOL_IDS) {
    base[tool] += adjust[tool] - composed[tool];
  }
  return clampAdjust(base);
}

export function autoAdjustEqual(a: AutoAdjust | null, b: AutoAdjust | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.amount - b.amount) < 1e-9 &&
    adjustEqual(a.suggestion, b.suggestion) &&
    (a.base && b.base ? adjustEqual(a.base, b.base) : (a.base ?? null) === (b.base ?? null))
  );
}
