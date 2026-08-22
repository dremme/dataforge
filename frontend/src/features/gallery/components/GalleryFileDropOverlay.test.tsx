import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GalleryFileDropOverlay } from "./GalleryFileDropOverlay";

function mountScrollRoot(clientHeight: number) {
  const main = document.createElement("main");
  main.className = "main";
  Object.defineProperty(main, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  document.body.append(main);
  return main;
}

describe("GalleryFileDropOverlay", () => {
  afterEach(() => {
    document.querySelector("main.main")?.remove();
  });

  it("renders nothing while inactive", () => {
    const { container } = render(<GalleryFileDropOverlay visible={false} folderLabel="Photos" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the folder being imported into", () => {
    render(<GalleryFileDropOverlay visible folderLabel="Photos" />);

    expect(screen.getByText("Drop files to import")).toBeInTheDocument();
    expect(screen.getByText("Photos")).toBeInTheDocument();
  });

  it("sizes the prompt to the visible scroller instead of the full gallery", () => {
    mountScrollRoot(640);

    const { container } = render(<GalleryFileDropOverlay visible folderLabel="Photos" />);

    expect(container.querySelector(".gallery-drop-overlay__viewport")).toHaveStyle({
      height: "640px",
    });
  });
});
