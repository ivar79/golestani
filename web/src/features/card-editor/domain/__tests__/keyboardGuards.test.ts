/**
 * The shared predicates every global keyboard listener now uses. These lock in
 * the two fixes at the source:
 *
 *   - the shortcuts overlay (aria-modal) must freeze the canvas handlers;
 *   - shortcuts are matched by PHYSICAL key (`code`), so a Persian/Arabic
 *     layout cannot turn Ctrl+Z / Ctrl+S / tool letters into dead keys.
 */
import { describe, expect, it } from "vitest";
import { codeOf } from "../keyboardGuards";

describe("codeOf — layout-independent physical keys", () => {
  it("returns the lower-case physical code, not the produced character", () => {
    // Persian layout: physical Z prints «ظ».
    expect(codeOf({ code: "KeyZ", key: "ظ" } as KeyboardEvent)).toBe("keyz");
    // Persian layout: physical S prints «س».
    expect(codeOf({ code: "KeyS", key: "س" } as KeyboardEvent)).toBe("keys");
    // Digits row and punctuation stay addressable too.
    expect(codeOf({ code: "Slash", key: "?" } as KeyboardEvent)).toBe("slash");
  });

  it("degrades to an empty string when a synthetic event carries no code", () => {
    expect(codeOf({ code: "" } as KeyboardEvent)).toBe("");
  });
});
