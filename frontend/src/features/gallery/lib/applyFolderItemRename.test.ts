import { describe, expect, it } from "vitest";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { applyFolderItemRename } from "./applyFolderItemRename";

describe("applyFolderItemRename", () => {
  it("gives the item its new path and name and leaves the rest of the listing", () => {
    const renamedPath = `${HOME_PATH}\\dusk.png`;

    const renamed = applyFolderItemRename(homeFolder, `${HOME_PATH}\\sunset.png`, renamedPath);

    expect(renamed.items.map((item) => item.name)).toEqual(["dusk.png", "beach.jpg", "waves.mp4"]);
    expect(renamed.items[0]).toMatchObject({
      path: renamedPath,
      description: "Golden hour over the lake",
    });
    expect(renamed.items.slice(1)).toEqual(homeFolder.items.slice(1));
    expect(renamed.fingerprint).toBe(homeFolder.fingerprint);
  });

  it("does not change the folder it was given", () => {
    applyFolderItemRename(homeFolder, `${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\dusk.png`);

    expect(homeFolder.items[0].name).toBe("sunset.png");
  });
});
