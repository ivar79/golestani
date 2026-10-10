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
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorEngine } from "../../engine/EditorEngine";
import { InspectorPanel, Toolbox } from "../EditorPanels";
import { LayeredCard, LayerVisual } from "../LayeredCardRenderer";
import { clearQrAssets, registerQrAsset } from "../../domain/qrAssets";
import { ARTBOARD, type CardDocument, type CardLayer, type ImageLayer, type QrLayer, type TextLayer } from "../../domain/document";

// VectorInspectors (imported by EditorPanels) links out to the pricing page.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
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
    render(<Toolbox engine={engine} qrPayload="golestani" />);

    fireEvent.keyDown(window, { key: "p" });
    expect(engine.getState().tool).toBe("pen");
    fireEvent.keyDown(window, { key: "b" });
    expect(engine.getState().tool).toBe("draw");
    fireEvent.keyDown(window, { key: "v" });
    expect(engine.getState().tool).toBe("select");
    fireEvent.keyDown(window, { key: "q" });
    expect(engine.getState().doc.layers).toHaveLength(1);
    expect((engine.getState().doc.layers[0] as QrLayer).payload).toBe("golestani");
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
    render(<Toolbox engine={engine} />);
    expect(screen.getByTitle("افزودن تصویر").hasAttribute("disabled")).toBe(true);
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
