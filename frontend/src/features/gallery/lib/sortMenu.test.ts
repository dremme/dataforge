import { describe, expect, it } from "vitest";
import { SORT_OPTIONS } from "@/features/gallery/lib/query";
import {
  iconArrowUpAZ,
  iconArrowUpNarrowWide,
  iconArrowDownWideNarrow,
  iconArrowDownZA,
} from "@/shared/icons";
import { SORT_FIELDS, sortDirectionIcon, sortFieldOf } from "./sortMenu";

describe("SORT_FIELDS", () => {
  it("offers every sort order exactly once", () => {
    const values = SORT_FIELDS.flatMap((field) => field.orders.map((order) => order.value));

    expect([...values].sort()).toEqual(SORT_OPTIONS.map((option) => option.value).sort());
  });

  it("finds the field an order belongs to", () => {
    expect(sortFieldOf("megapixels-asc").label).toBe("Megapixels");
  });
});

describe("sortDirectionIcon", () => {
  it("shows letters for names and the stack's direction otherwise", () => {
    expect(sortDirectionIcon("name-asc")).toBe(iconArrowUpAZ);
    expect(sortDirectionIcon("name-desc")).toBe(iconArrowDownZA);
    expect(sortDirectionIcon("caption-asc")).toBe(iconArrowUpNarrowWide);
    expect(sortDirectionIcon("date-desc")).toBe(iconArrowDownWideNarrow);
  });
});
