import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenEstimate } from "./TokenEstimate";

describe("TokenEstimate", () => {
  it("reports the estimate as approximate", () => {
    render(<TokenEstimate text="Golden hour over the lake" />);

    expect(screen.getByText("~7 tokens")).toBeInTheDocument();
  });

  it("explains that the count depends on the model", () => {
    render(<TokenEstimate text="Golden hour over the lake" />);

    expect(screen.getByText("~7 tokens")).toHaveAttribute(
      "title",
      "Estimated from text length; the exact count depends on the model",
    );
  });

  it("counts blank text as zero", () => {
    render(<TokenEstimate text="   " />);

    expect(screen.getByText("~0 tokens")).toBeInTheDocument();
  });

  it("passes the class name through", () => {
    render(<TokenEstimate text="Short" className="caption-tokens" />);

    expect(screen.getByText("~2 tokens")).toHaveClass("caption-tokens");
  });
});
