// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  pickActiveBusiness,
  readActiveBusinessId,
  writeActiveBusinessId,
} from "./activeBusiness";

afterEach(() => {
  window.localStorage.clear();
});

describe("active business selection", () => {
  const businesses = [{ id: 63 }, { id: 84 }];

  it("remembers and restores an owned business", () => {
    writeActiveBusinessId(84);

    expect(readActiveBusinessId()).toBe(84);
    expect(pickActiveBusiness(businesses)).toEqual({ id: 84 });
  });

  it("falls back to the first business when the remembered one is not owned", () => {
    writeActiveBusinessId(999);

    expect(pickActiveBusiness(businesses)).toEqual({ id: 63 });
  });

  it("lets an explicit URL selection take precedence and persists it", () => {
    writeActiveBusinessId(84);

    const selected = pickActiveBusiness(businesses, 63);
    if (selected) writeActiveBusinessId(selected.id);

    expect(selected).toEqual({ id: 63 });
    expect(readActiveBusinessId()).toBe(63);
  });
});
