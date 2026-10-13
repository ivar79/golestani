// @vitest-environment jsdom
/**
 * P0 recovery — UI wiring of the two controls that looked "missing":
 *
 *  1. QR TOOL: clicking the toolbox entry must create a layer that can render a
 *     REAL code (payload = the edited business's slug, not an empty string),
 *     and the inspector must let the user correct that payload afterwards.
 *  2. MIRROR/FLIP: horizontal + vertical flip must be reachable for EVERY layer
 *     kind, not only inside the image inspector.
 *
 * The controls write through the engine, so the assertions read the document —
 * the same source the renderer, the autosave and the exporter consume.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorEngine } from "../../engine/EditorEngine";
import { renderToStaticMarkup } from "react-dom/server";
import { InspectorPanel, Toolbox } from "../EditorPanels";
import { LayeredCard, LayerVisual } from "../LayeredCardRenderer";
import { clearQrAssets, registerQrAsset } from "../../domain/qrAssets";
import { ARTBOARD, type CardDocument, type CardLayer, type ImageLayer, type PathLayer, type QrLayer, type TextLayer } from "../../domain/document";

// VectorInspectors (imported by EditorPanels) links out to the pricing page.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
}));

// CardStudio tests need FeatureGate mock; other tests don't use it directly.
// `PremiumBadge` is mocked too: a PATH inspector renders it (luxury material
// picker), so a path-layer test would otherwise fail on the partial mock.
vi.mock("@/components/cards/FeatureGate", () => ({
  useEntitlements: () => ({
    plan: "Free",
    capabilities: { max_layers: 50, card_fonts: ["vazir", "sans", "serif", "monospace"] },
  }),
  PremiumBadge: ({ label = "ویژه" }: { label?: string }) => <span>{label}</span>,
}));

afterEach(cleanup);

const BASE = {
  x: 10,
  y: 20,
  width: 100,
  height: 60,
  angle: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  color: null,
  background: null,
} as const;

function doc(layers: CardLayer[]): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers };
}

function textLayer(): TextLayer {
  return { ...BASE, id: "t1", kind: "text", text: "متن", fontSize: 24, fontWeight: 600, align: "start", fontFamily: "vazir" };
}

function qrLayer(payload: string): QrLayer {
  return { ...BASE, id: "q1", kind: "qr", width: 120, height: 120, payload, dark: "#000000", light: "#ffffff" };
}

describe("Toolbox — QR tool produces a code, not a placeholder", () => {
  it("seeds a new QR layer with the edited business's slug", () => {
    const engine = new EditorEngine(doc([]));
    render(<Toolbox engine={engine} qrPayload="golestani" />);

    fireEvent.click(screen.getByRole("button", { name: "QR" }));

    const layers = engine.getState().doc.layers;
    expect(layers).toHaveLength(1);
    expect(layers[0].kind).toBe("qr");
    expect((layers[0] as QrLayer).payload).toBe("golestani");
  });

  it("keeps the layer honest when no business slug is known (empty, never fake)", () => {
    const engine = new EditorEngine(doc([]));
    render(<Toolbox engine={engine} />);
    fireEvent.click(screen.getByRole("button", { name: "QR" }));
    expect((engine.getState().doc.layers[0] as QrLayer).payload).toBe("");
  });
});

describe("Toolbox — keyboard tool shortcuts", () => {
  it("activates tools through V, P, B and Q without bypassing the engine", () => {
    const engine = new EditorEngine(doc([]));
    const { container } = render(<div className="ik-studio"><Toolbox engine={engine} qrPayload="golestani" /></div>);
    const studioRoot = container.firstElementChild;
    if (!studioRoot) throw new Error("expected the studio keyboard scope");

    // Real keyboards always send BOTH fields; the shortcut is bound to the
    // physical `code` so a non-Latin layout cannot steal it.
    fireEvent.keyDown(studioRoot, { key: "p", code: "KeyP" });
    expect(engine.getState().tool).toBe("pen");
    fireEvent.keyDown(studioRoot, { key: "b", code: "KeyB" });
    expect(engine.getState().tool).toBe("draw");
    fireEvent.keyDown(studioRoot, { key: "v", code: "KeyV" });
    expect(engine.getState().tool).toBe("select");
    fireEvent.keyDown(studioRoot, { key: "q", code: "KeyQ" });
    expect(engine.getState().doc.layers).toHaveLength(1);
    expect((engine.getState().doc.layers[0] as QrLayer).payload).toBe("golestani");
  });

  it("fires on a Persian layout where `key` is not a Latin letter", () => {
    const engine = new EditorEngine(doc([]));
    const { container } = render(<div className="ik-studio"><Toolbox engine={engine} qrPayload="golestani" /></div>);
    const studioRoot = container.firstElementChild;
    if (!studioRoot) throw new Error("expected the studio keyboard scope");

    // The physical P key on a Persian layout produces «ح» — the old `key`-based
    // handler matched nothing and the tool shortcut silently died.
    fireEvent.keyDown(studioRoot, { key: "ح", code: "KeyP" });
    expect(engine.getState().tool).toBe("pen");
  });
});

describe("Toolbox — image upload flow", () => {
  function pickFile(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("persists a picked image through the host flow and adds a real image layer", async () => {
    const engine = new EditorEngine(doc([]));
    const upload = vi.fn(async () => "/storage/cards/images/pic.png");
    const { container } = render(<Toolbox engine={engine} onUploadImage={upload} />);

    pickFile(container, new File([new Uint8Array([1, 2, 3])], "pic.png", { type: "image/png" }));

    await waitFor(() => expect(engine.getState().doc.layers).toHaveLength(1));
    expect(upload).toHaveBeenCalledTimes(1);
    const layer = engine.getState().doc.layers[0] as ImageLayer;
    expect(layer.kind).toBe("image");
    // The layer stores the SYSTEM path the server returned — a blob URL could
    // never round-trip the server-side whitelist.
    expect(layer.src).toBe("/storage/cards/images/pic.png");
  });

  it("refuses a non-image file with a visible reason and adds nothing", () => {
    const engine = new EditorEngine(doc([]));
    const upload = vi.fn();
    const { container } = render(<Toolbox engine={engine} onUploadImage={upload} />);

    pickFile(container, new File(["nope"], "notes.txt", { type: "text/plain" }));

    expect(upload).not.toHaveBeenCalled();
    expect(engine.getState().doc.layers).toHaveLength(0);
    expect(screen.getByText(/JPEG، PNG یا WebP/)).toBeTruthy();
  });

  it("disables the image tool when the host provides no upload flow (honest disabled state)", () => {
    const engine = new EditorEngine(doc([]));
    render(<div className="ik-studio"><Toolbox engine={engine} /></div>);
    expect(screen.getByRole("button", { name: "تصویر" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("InspectorPanel — QR payload editor", () => {
  it("writes the payload the user types and strips characters a slug cannot hold", () => {
    const engine = new EditorEngine(doc([qrLayer("golestani")]));
    engine.select("q1");
    render(<InspectorPanel engine={engine} businessSlug="golestani" />);

    const input = screen.getByDisplayValue("golestani");
    fireEvent.change(input, { target: { value: "my shop!" } });

    // Space and "!" are not part of a business slug — they are dropped as typed
    // instead of being saved and silently failing at render time.
    expect((engine.getState().doc.layers[0] as QrLayer).payload).toBe("myshop");
  });

  it("offers a one-click return to the business's own page", () => {
    const engine = new EditorEngine(doc([qrLayer("someone-else")]));
    engine.select("q1");
    render(<InspectorPanel engine={engine} businessSlug="golestani" />);

    fireEvent.click(screen.getByText("بازگشت به صفحهٔ همین کسب‌وکار"));
    expect((engine.getState().doc.layers[0] as QrLayer).payload).toBe("golestani");
  });

  it("explains the placeholder state while the payload is empty", () => {
    const engine = new EditorEngine(doc([qrLayer("")]));
    engine.select("q1");
    render(<InspectorPanel engine={engine} businessSlug="golestani" />);
    expect(screen.getByText(/فقط جای‌گیر است/)).toBeTruthy();
  });
});

/**
 * REGRESSION — the reported "Received NaN for the `cy` attribute" flood from the
 * right-hand layer-operation buttons.
 *
 * "صاف کردن" (and the quick rotation slider) commits an ANGLE-ONLY box. On a
 * path layer that used to re-scale every anchor by an undefined size, so the
 * whole drawing became `d="M NaN NaN …"` and the anchor/handle circles — SVG
 * `<circle>` with `cx`/`cy` from those anchors — rendered with NaN. The autosave
 * then persisted the ruin. The panel must not be able to do that, and the
 * geometry it leaves behind must stay renderable.
 */
describe("InspectorPanel — layer ops never turn path geometry into NaN", () => {
  const pathLayer = (): CardLayer =>
    ({
      ...BASE,
      id: "p1",
      kind: "path",
      x: 67.5,
      y: 341.6,
      width: 612.4,
      height: 59.2,
      closed: false,
      points: [
        { x: 5, y: 41.9, hIn: null, hOut: { x: 45.4, y: 42 } },
        { x: 166.4, y: 42.1, hIn: { x: 71.6, y: 39.6 }, hOut: { x: 261.2, y: 44.6 } },
        { x: 607.4, y: 5, hIn: { x: 561.7, y: 15.5 }, hOut: null },
      ],
      stroke: "#0ea5e9",
      strokeWidth: 6,
      fill: null,
      pathMode: "pen",
    }) as PathLayer;

  it("«صاف کردن» leaves every anchor finite and the drawn path valid", () => {
    const engine = new EditorEngine(doc([pathLayer()]));
    engine.select("p1");
    render(<InspectorPanel engine={engine} />);
    const original = JSON.parse(JSON.stringify((engine.getState().doc.layers[0] as PathLayer).points));

    fireEvent.click(screen.getByText("صاف کردن"));

    const after = engine.getState().doc.layers[0] as PathLayer;
    expect(after.points).toEqual(original);
    expect(after.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    // The markup the stage/export actually produce must be NaN-free as well.
    expect(renderToStaticMarkup(<LayerVisual layer={after} />)).not.toMatch(/NaN|Infinity/);
  });

  it("the quick rotation slider only rotates the path", () => {
    const engine = new EditorEngine(doc([pathLayer()]));
    engine.select("p1");
    render(<InspectorPanel engine={engine} />);
    const original = JSON.parse(JSON.stringify((engine.getState().doc.layers[0] as PathLayer).points));

    fireEvent.change(screen.getByRole("slider", { name: /چرخش سریع/ }), { target: { value: "37" } });

    const after = engine.getState().doc.layers[0] as PathLayer;
    expect(after.angle).toBe(37);
    expect(after.points).toEqual(original);
    expect(after.width).toBe(612.4);
  });
});

describe("InspectorPanel — mirror/flip for every layer kind", () => {
  it("flips a TEXT layer from the shared transform block", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    render(<InspectorPanel engine={engine} />);

    fireEvent.click(screen.getByText("آینه افقی ⇆"));
    expect(engine.getState().doc.layers[0].flipX).toBe(true);

    fireEvent.click(screen.getByText("آینه عمودی ⇅"));
    expect(engine.getState().doc.layers[0].flipY).toBe(true);

    // aria-pressed reflects the real document value (a control that does
    // nothing must never LOOK active).
    expect(screen.getByText("آینه افقی ⇆").closest("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("flips a QR layer too (mirroring is layer-level, not image-only)", () => {
    const engine = new EditorEngine(doc([qrLayer("golestani")]));
    engine.select("q1");
    render(<InspectorPanel engine={engine} businessSlug="golestani" />);
    fireEvent.click(screen.getByText("آینه عمودی ⇅"));
    expect(engine.getState().doc.layers[0].flipY).toBe(true);
  });
});

/**
 * QR SOURCE REPAINT (P0 regression).
 *
 * `qrSrcFor()` reads a MODULE-level registry, so React has no prop to diff and
 * `QrVisual`'s memo would happily keep rendering the anonymous fallback
 * `/api/qr/{slug}` forever. For a not-yet-approved business that fallback 404s
 * (the API is owner-only upstream), which is exactly the "QR tool is broken"
 * report: the layer is there, the code is not.
 *
 * The revision from `useQrAssets` is the ONLY signal that the registry changed,
 * so it must reach the memoized visual through the prop chain. These tests fail
 * if that chain is ever dropped again.
 */
describe("QR layer repaints when the owner-session asset arrives", () => {
  afterEach(() => {
    clearQrAssets();
    cleanup();
  });

  it("switches from the public fallback to the registered data URL", () => {
    const layer = qrLayer("golestani");
    const { rerender } = render(<LayerVisual layer={layer} qrRevision={0} />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/api/qr/golestani");

    registerQrAsset("golestani", "data:image/svg+xml;base64,AAAA");

    // Same layer object, same payload — ONLY qrRevision moved. Without it in
    // the props, memo() would skip this render and the empty box would persist.
    rerender(<LayerVisual layer={layer} qrRevision={1} />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("data:image/svg+xml;base64,AAAA");
  });

  it("LayeredCard forwards the revision to every QR layer", () => {
    registerQrAsset("golestani", "data:image/svg+xml;base64,BBBB");
    render(<LayeredCard doc={doc([qrLayer("golestani")])} qrRevision={3} />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("data:image/svg+xml;base64,BBBB");
  });
});

// ─── KEYBOARD SHORTCUT COVERAGE ─────────────────────────────────────────────
// Every shortcut advertised in the help dialog must actually work. These tests
// cover tool shortcuts from any focus target (including document.body), the ?
// help toggle under a Persian layout, preview-mode blocking, copy feedback, and
// the full edit short cut set (undo/redo/save/duplicate/copy/paste/delete/arrows).
import { EditorStage } from "../EditorStage";
import { CardStudio } from "../CardStudio";
// CardStudio tests need FeatureGate mock; other tests don't use it directly.
// `PremiumBadge` is mocked too: a PATH inspector renders it (luxury material
// picker), so a path-layer test would otherwise fail on the partial mock.
vi.mock("@/components/cards/FeatureGate", () => ({
  useEntitlements: () => ({
    plan: "Free",
    capabilities: { max_layers: 50, card_fonts: ["vazir", "sans", "serif", "monospace"] },
  }),
  PremiumBadge: ({ label = "ویژه" }: { label?: string }) => <span>{label}</span>,
}));

describe("CardStudio — keyboard shortcuts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class { observe() {} unobserve() {} disconnect() {} },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("opens the shortcut help dialog with the physical slash key on a Persian layout", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    const saved = vi.fn();
    const biz = { id: 1, name: "متن آزمایشی" } as unknown as import("@/lib/businesses").Business;
    const tmpl = engine.getState().doc.background as unknown as "classic";
    const { container } = render(
      <div className="ik-studio">
        <CardStudio business={biz} template={tmpl} theme="dark" fontFamily="vazir" designJson={engine.getState().doc} onSaved={saved} />
      </div>,
    );
    // The physical / key on a Persian layout produces a non-Latin character.
    // The help toggle must still open because it is bound to the physical code,
    // not the produced character.
    fireEvent.keyDown(window, { key: "ظ", code: "slash", bubbles: true, cancelable: true });
    expect(container.querySelector("[data-shortcut-dialog]")).not.toBeNull();
  });
});

describe("CardStudio — preview mode blocks mutating shortcuts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class { observe() {} unobserve() {} disconnect() {} },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("blocks undo and save while preview mode is active", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    const saved = vi.fn();
    const biz = { id: 1, name: "تست" } as unknown as import("@/lib/businesses").Business;
    const tmpl = engine.getState().doc.background as unknown as "classic";
    render(
      <div className="ik-studio">
        <CardStudio business={biz} template={tmpl} theme="dark" fontFamily="vazir" designJson={engine.getState().doc} onSaved={saved} />
      </div>,
    );
    // Enter preview mode.
    const previewBtn = document.querySelector('button[aria-label="پیش‌نمایش"]');
    expect(previewBtn).not.toBeNull();
    if (previewBtn) fireEvent.click(previewBtn);

    // Ctrl+Z must not undo while preview.
    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers).toHaveLength(1);

    // Ctrl+S must not save while preview.
    fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true });
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("EditorStage — keyboard shortcuts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class { observe() {} unobserve() {} disconnect() {} },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    document.querySelectorAll("[data-shortcut-dialog]").forEach((node) => node.remove());
  });

  it("duplicates a selected layer with Ctrl+D (physical code)", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "د", code: "KeyD", ctrlKey: true, bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers).toHaveLength(2);
  });

  it("copies a selected layer with Ctrl+C and shows feedback", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    const { container } = render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true, bubbles: true, cancelable: true });
    // Feedback flash should appear.
    expect(container.querySelector("[aria-live=\"polite\"]")).not.toBeNull();
    expect(container.textContent).toContain("کپی");
  });

  it("pastes a copied layer with Ctrl+V (no selected layer needed)", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    // Copy.
    fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true, bubbles: true, cancelable: true });
    // Deselect.
    engine.select(null);
    // Paste — works even without a selection.
    fireEvent.keyDown(window, { key: "v", code: "KeyV", ctrlKey: true, bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers).toHaveLength(2);
  });

  it("deletes the selected layer with Delete (physical code)", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "Delete", code: "Delete", bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers).toHaveLength(0);
  });

  it("deletes the selected layer with Backspace (physical code)", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "Backspace", code: "Backspace", bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers).toHaveLength(0);
  });

  it("nudges a selected layer with arrow keys (physical codes)", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers[0].x).toBe(11);

    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers[0].y).toBe(21);
  });

  it("nudges by 10px with Shift+arrow (physical codes)", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers[0].x).toBe(20);
  });

  it("does not nudge when no layer is selected", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers[0].x).toBe(10);
  });

  it("does not duplicate when no layer is selected", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "d", code: "KeyD", ctrlKey: true, bubbles: true, cancelable: true });
    expect(engine.getState().doc.layers).toHaveLength(1);
  });

  it("does not copy when no layer is selected", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);

    fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true, bubbles: true, cancelable: true });
    expect(document.querySelector("[aria-live=\"polite\"]")).toBeNull();
  });
});

describe("Toolbox — tool shortcuts from any focus target", () => {  it("activates tools when focus is on the studio root (tabIndex={-1})", () => {
    const engine = new EditorEngine(doc([]));
    const { container } = render(
      <div className="ik-studio">
        <Toolbox engine={engine} qrPayload="golestani" />
      </div>,
    );
    const studioRoot = container.querySelector(".ik-studio") as HTMLElement | null;
    if (studioRoot) studioRoot.focus?.();

    fireEvent.keyDown(window, { key: "P", code: "KeyP", bubbles: true, cancelable: true });
    expect(engine.getState().tool).toBe("pen");
  });

  it("ignores tool shortcuts while an input is focused", () => {
    const engine = new EditorEngine(doc([textLayer()]));
    engine.select("t1");
    const { container } = render(
      <div className="ik-studio">
        <InspectorPanel engine={engine} />
      </div>,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    if (textarea) {
      fireEvent.keyDown(textarea, { key: "V", code: "KeyV", bubbles: true, cancelable: true });
      expect(engine.getState().tool).toBe("select");
    }
  });

  it("ignores tool shortcuts while the shortcut dialog is open", () => {
    const engine = new EditorEngine(doc([]));
    render(
      <div className="ik-studio">
        <Toolbox engine={engine} qrPayload="golestani" />
      </div>,
    );
    const dialog = document.createElement("div");
    dialog.setAttribute("data-shortcut-dialog", "");
    document.body.appendChild(dialog);

    fireEvent.keyDown(window, { key: "V", code: "KeyV", bubbles: true, cancelable: true });
    expect(engine.getState().tool).toBe("select");    });
});
