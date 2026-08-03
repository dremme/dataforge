import { describe, expect, it } from "vitest";
import { failureMessage, pathBaseName } from "./mediaActionMessages";

describe("pathBaseName", () => {
  it("takes the leaf of a Windows path", () => {
    expect(pathBaseName("C:\\Photos\\Vacation\\sunset.png")).toBe("sunset.png");
  });

  it("takes the leaf of a POSIX path", () => {
    expect(pathBaseName("/home/photos/sunset.png")).toBe("sunset.png");
  });

  it("returns a bare name unchanged", () => {
    expect(pathBaseName("sunset.png")).toBe("sunset.png");
  });
});

describe("failureMessage", () => {
  it("uses a transfer's raw detail string as the reason", () => {
    const message = failureMessage("move", [
      { path: "C:\\Photos\\sunset.png", error: "destination is read-only" },
    ]);

    expect(message).toBe("Could not move sunset.png: destination is read-only");
  });

  it("formats a thrown request error as the reason", () => {
    const message = failureMessage("delete", [
      { path: "C:\\Photos\\sunset.png", error: new Error("Permission denied") },
    ]);

    expect(message).toBe("Could not delete sunset.png: Permission denied");
  });

  it("counts the batch and names only the first casualty", () => {
    const message = failureMessage("copy", [
      { path: "C:\\Photos\\sunset.png", error: "in use" },
      { path: "C:\\Photos\\beach.jpg", error: "in use" },
      { path: "C:\\Photos\\lake.png", error: "in use" },
    ]);

    expect(message).toBe("Could not copy 3 files. sunset.png: in use");
  });
});
