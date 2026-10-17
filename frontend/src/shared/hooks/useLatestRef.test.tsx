import { useLayoutEffect } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RefObject } from "react";
import { useLatestRef } from "./useLatestRef";

function Child({ read }: { read: () => void }) {
  useLayoutEffect(() => {
    read();
  });
  return null;
}

function Owner({ value, seen }: { value: number; seen: number[] }) {
  const ref: RefObject<number> = useLatestRef(value);
  return <Child read={() => seen.push(ref.current)} />;
}

describe("useLatestRef", () => {
  it("is current in a child's layout effect on the same commit", () => {
    const seen: number[] = [];
    const { rerender } = render(<Owner value={1} seen={seen} />);
    rerender(<Owner value={2} seen={seen} />);

    expect(seen.at(-1)).toBe(2);
  });
});
