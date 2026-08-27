import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialogScope } from "./DialogScope";

describe("DialogScope", () => {
  it("names the selection when one is narrowing the job", () => {
    const { container } = render(<DialogScope itemCount={23} folderLabel="Photos" fromSelection />);

    expect(container.querySelector(".dialog-scope__line")).toHaveTextContent(
      "23 selected files in Photos",
    );
  });

  it("says the whole folder when nothing is selected", () => {
    const { container } = render(
      <DialogScope itemCount={2473} folderLabel="Photos" fromSelection={false} />,
    );

    expect(container.querySelector(".dialog-scope__line")).toHaveTextContent(
      "All 2473 files in Photos",
    );
  });

  it("keeps the count singular for one file", () => {
    const { container } = render(<DialogScope itemCount={1} folderLabel="Photos" fromSelection />);

    expect(container.querySelector(".dialog-scope__line")).toHaveTextContent(
      "1 selected file in Photos",
    );
  });

  it("renders a note when the scope needs explaining", () => {
    render(
      <DialogScope
        itemCount={40}
        folderLabel="landscapes"
        fromSelection={false}
        note="AI-Toolkit trains on the whole folder."
      />,
    );

    expect(screen.getByText("AI-Toolkit trains on the whole folder.")).toBeInTheDocument();
  });

  it("leaves the note out when there is nothing to explain", () => {
    const { container } = render(
      <DialogScope itemCount={40} folderLabel="landscapes" fromSelection={false} />,
    );

    expect(container.querySelector(".dialog-scope__note")).toBeNull();
  });
});
