import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModalScope } from "./ModalScope";

describe("ModalScope", () => {
  it("names the selection when one is narrowing the job", () => {
    const { container } = render(
      <ModalScope itemCount={23} folderLabel="Photos" kind="selected" />,
    );

    expect(container.querySelector(".modal-scope__line")).toHaveTextContent(
      "23 selected files in Photos",
    );
  });

  it("says the whole folder when nothing is selected", () => {
    const { container } = render(
      <ModalScope itemCount={2473} folderLabel="Photos" kind="folder" />,
    );

    expect(container.querySelector(".modal-scope__line")).toHaveTextContent(
      "All 2473 files in Photos",
    );
  });

  it("keeps the count singular for one file", () => {
    const { container } = render(<ModalScope itemCount={1} folderLabel="Photos" kind="selected" />);

    expect(container.querySelector(".modal-scope__line")).toHaveTextContent(
      "1 selected file in Photos",
    );
  });

  it("renders a note when the scope needs explaining", () => {
    render(
      <ModalScope
        itemCount={40}
        folderLabel="landscapes"
        kind="folder"
        note="AI-Toolkit trains on the whole folder."
      />,
    );

    expect(screen.getByText("AI-Toolkit trains on the whole folder.")).toBeInTheDocument();
  });

  it("leaves the note out when there is nothing to explain", () => {
    const { container } = render(
      <ModalScope itemCount={40} folderLabel="landscapes" kind="folder" />,
    );

    expect(container.querySelector(".modal-scope__note")).toBeNull();
  });
});
