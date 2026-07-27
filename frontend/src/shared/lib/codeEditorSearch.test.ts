import { describe, expect, it, vi } from "vitest";
import { closeCodeEditorSearchPanel } from "./codeEditorSearch";

describe("closeCodeEditorSearchPanel", () => {
  it("returns false when no search panel is open", () => {
    const root = document.createElement("div");
    expect(closeCodeEditorSearchPanel(root)).toBe(false);
    expect(closeCodeEditorSearchPanel(null)).toBe(false);
  });

  it("clicks the search panel close control and returns true", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="cm-panel cm-search">
        <button name="close" type="button">×</button>
      </div>
    `;
    const closeButton = root.querySelector("button") as HTMLButtonElement;
    const click = vi.spyOn(closeButton, "click");

    expect(closeCodeEditorSearchPanel(root)).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });
});
