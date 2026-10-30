import { describe, expect, it } from "vitest";
import {
  cardOptionsFromWire,
  cardOptionsToWire,
  DEFAULT_CARD_OPTIONS,
  readCardOptions,
  sameCardOptions,
} from "./cardOptions";

function mirrored(options: object) {
  localStorage.setItem("gallery-card-options", JSON.stringify(options));
  return readCardOptions();
}

describe("card actions in the card options", () => {
  it("default to Open, Copy caption and Delete", () => {
    expect(DEFAULT_CARD_OPTIONS.cardActions).toEqual(["open", "copy_caption", "delete"]);
  });

  it("take the default when a mirror predates them", () => {
    expect(mirrored({ megapixels: false }).cardActions).toEqual(DEFAULT_CARD_OPTIONS.cardActions);
  });

  it("stay empty when empty was chosen", () => {
    expect(mirrored({ cardActions: [] }).cardActions).toEqual([]);
  });

  it("drop what the build does not know and follow the catalog's order", () => {
    expect(mirrored({ cardActions: ["delete", "launch", "open"] }).cardActions).toEqual([
      "open",
      "delete",
    ]);
  });

  it("round-trip through the wire format", () => {
    const options = { ...DEFAULT_CARD_OPTIONS, cardActions: ["rename_file" as const] };

    expect(cardOptionsFromWire(cardOptionsToWire(options))).toEqual(options);
  });
});

describe("sameCardOptions", () => {
  it("compares card actions by what they hold", () => {
    const copy = { ...DEFAULT_CARD_OPTIONS, cardActions: [...DEFAULT_CARD_OPTIONS.cardActions] };

    expect(sameCardOptions(DEFAULT_CARD_OPTIONS, copy)).toBe(true);
  });

  it("tells different card actions apart", () => {
    expect(
      sameCardOptions(DEFAULT_CARD_OPTIONS, {
        ...DEFAULT_CARD_OPTIONS,
        cardActions: ["open", "copy_caption", "move_file"],
      }),
    ).toBe(false);
    expect(
      sameCardOptions(DEFAULT_CARD_OPTIONS, { ...DEFAULT_CARD_OPTIONS, cardActions: ["open"] }),
    ).toBe(false);
  });

  it("still tells the other options apart", () => {
    expect(
      sameCardOptions(DEFAULT_CARD_OPTIONS, { ...DEFAULT_CARD_OPTIONS, megapixels: false }),
    ).toBe(false);
  });
});
