import { describe, expect, it } from "vitest";
import { resolveCardRender, type PublicCardScalars } from "./publicCard";
import { ARTBOARD, type CardDocument } from "@/features/card-editor/domain/document";

function design(): CardDocument {
  return {
    version: 1,
    artboard: { ...ARTBOARD },
    background: "#ffffff",
    layers: [
      {
        id: "text-1",
        kind: "text",
        x: 10,
        y: 10,
        width: 200,
        height: 40,
        angle: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        color: "#000000",
        background: null,
        text: "سلام",
        fontSize: 24,
        fontWeight: 600,
        align: "start",
        fontFamily: "vazir",
      },
    ],
  };
}

const base: PublicCardScalars = {
  template: "classic",
  theme: "navy",
  font_size: "medium",
  font_family: "sans",
  design_json: null,
};

/**
 * The public fallback chain. Legacy cards must never regress, and a malformed
 * document must never blank the page.
 */
describe("resolveCardRender", () => {
  it("renders the layered design when a valid document is published", () => {
    const plan = resolveCardRender({ ...base, design_json: design() });
    expect(plan.mode).toBe("design");
    if (plan.mode === "design") {
      expect(plan.design.layers).toHaveLength(1);
      expect(plan.design.artboard).toEqual(ARTBOARD);
    }
  });

  it("falls back to the template for a card that has no document", () => {
    const plan = resolveCardRender(base);
    expect(plan).toMatchObject({
      mode: "legacy",
      reason: "no-design",
      template: "classic",
      theme: "navy",
      fontSize: "medium",
      fontFamily: "sans",
    });
  });

  it("falls back to the template (with a reason) for a malformed document", () => {
    const plan = resolveCardRender({
      ...base,
      design_json: { version: 99, layers: "nope" } as unknown as CardDocument,
    });
    expect(plan).toMatchObject({ mode: "legacy", reason: "invalid-design" });
  });

  it("treats a missing card payload as legacy, not as an error", () => {
    expect(resolveCardRender(null)).toMatchObject({ mode: "legacy", reason: "no-design" });
    expect(resolveCardRender(undefined)).toMatchObject({ mode: "legacy", reason: "no-design" });
  });

  it("normalizes unknown scalar values to the renderable defaults", () => {
    const plan = resolveCardRender({
      ...base,
      template: "hacked",
      theme: "hotpink",
      font_size: "gigantic",
      font_family: "comic-sans",
    });
    expect(plan).toMatchObject({
      template: "classic",
      theme: "navy",
      fontSize: "medium",
      fontFamily: "sans",
    });
  });

  it("keeps a valid template/theme when falling back", () => {
    const plan = resolveCardRender({ ...base, template: "midnight", theme: "warm", font_family: "serif" });
    expect(plan).toMatchObject({ mode: "legacy", template: "midnight", theme: "warm", fontFamily: "serif" });
  });
});
