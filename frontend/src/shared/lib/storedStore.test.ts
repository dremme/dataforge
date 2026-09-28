import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createStoredStore, useStoredStore } from "./storedStore";

const parseCount = (raw: string | null) => Number(raw ?? 0);

describe("createStoredStore", () => {
  it("starts from the stored value and persists what is set", () => {
    localStorage.setItem("count-a", "4");
    const store = createStoredStore("count-a", parseCount);

    store.set(5);

    expect(store.get()).toBe(5);
    expect(localStorage.getItem("count-a")).toBe("5");
  });

  it("follows a value another tab stored", () => {
    const store = createStoredStore("count-b", parseCount);
    const { result } = renderHook(() => useStoredStore(store));

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "count-b", newValue: "9" }));
    });

    expect(result.current).toBe(9);
  });

  it("ignores other keys and unchanged values", () => {
    const store = createStoredStore("count-c", parseCount);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    window.dispatchEvent(new StorageEvent("storage", { key: "count-other", newValue: "3" }));
    store.set(0);

    expect(notified).toBe(0);
  });
});
