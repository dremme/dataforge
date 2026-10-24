import { describe, expect, it } from "vitest";
import { withJobPaths } from "./jobPaths";

describe("withJobPaths", () => {
  it("omits paths only when there is no selection to send", () => {
    expect(withJobPaths({ caption: "A lake." })).toEqual({ caption: "A lake." });
  });

  it("sends an empty selection as it is, so the server refuses it instead of the folder", () => {
    expect(withJobPaths({ caption: "A lake." }, [])).toEqual({ caption: "A lake.", paths: [] });
  });

  it("sends a selection", () => {
    expect(withJobPaths({}, ["C:\\Photos\\sunset.png"])).toEqual({
      paths: ["C:\\Photos\\sunset.png"],
    });
  });
});
