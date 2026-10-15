import { describe, expect, it } from "vitest";
import { folderPathsEqual, normalizeFolderPath } from "./folderPath";

describe("folderPath", () => {
  it("preserves Windows drive roots when normalizing", () => {
    expect(normalizeFolderPath("C:\\")).toBe("C:\\");
    expect(normalizeFolderPath("C:")).toBe("C:\\");
    expect(normalizeFolderPath("c:/")).toBe("C:\\");
  });

  it("treats drive root paths as equal", () => {
    expect(folderPathsEqual("C:\\", "C:")).toBe(true);
    expect(folderPathsEqual("C:/", "C:\\")).toBe(true);
  });

  it("still normalizes regular folder paths", () => {
    expect(normalizeFolderPath("C:/Photos/Vacation/")).toBe("C:\\Photos\\Vacation");
  });

  it("keeps POSIX paths in their own separators", () => {
    expect(normalizeFolderPath("/home/dev/Photos/")).toBe("/home/dev/Photos");
    expect(normalizeFolderPath("/")).toBe("/");
    expect(folderPathsEqual("/home/dev/Photos", "/home/dev/Photos/")).toBe(true);
  });

  it("still treats a forward-slash network share as Windows", () => {
    expect(normalizeFolderPath("//server/share/")).toBe("\\\\server\\share");
  });
});
