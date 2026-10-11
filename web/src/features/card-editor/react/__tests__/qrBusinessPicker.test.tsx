// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { searchBusinesses } from "@/lib/businesses";
import { ARTBOARD, type CardDocument, type QrLayer } from "../../domain/document";
import { EditorEngine } from "../../engine/EditorEngine";
import { InspectorPanel } from "../EditorPanels";

vi.mock("@/lib/businesses", () => ({ searchBusinesses: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
}));

const mockSearchBusinesses = vi.mocked(searchBusinesses);

function qrDocument(): CardDocument {
  const qr: QrLayer = {
    id: "qr-1", kind: "qr", x: 20, y: 20, width: 120, height: 120, angle: 0,
    opacity: 1, locked: false, hidden: false, color: null, background: null,
    payload: "own-business", dark: "#000000", light: "#ffffff",
  };
  return { version: 1, artboard: { ...ARTBOARD }, background: "#fff", layers: [qr] };
}

describe("InspectorPanel — choosing another public business QR", () => {
  beforeEach(() => {
    mockSearchBusinesses.mockReset();
  });
  afterEach(() => cleanup());

  it("selects the canonical slug from public search results", async () => {
    mockSearchBusinesses.mockResolvedValue({
      data: [{
        id: 24, name: "کافه مقصد", slug: "destination-cafe", category: "کافه و رستوران",
        city: "تهران", status: "approved",
      }],
      unclaimed: [],
      pagination: { page: 1, limit: 8, total: 1, last_page: 1, next_page: null, unclaimed_total: 0 },
    } as never);

    const engine = new EditorEngine(qrDocument());
    engine.select("qr-1");
    render(<InspectorPanel engine={engine} businessSlug="own-business" />);

    fireEvent.change(screen.getByPlaceholderText("نام کسب‌وکار، دسته‌بندی یا شهر"), {
      target: { value: "کافه مقصد" },
    });

    await waitFor(() => expect(mockSearchBusinesses).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /کافه مقصد/ }));

    expect((engine.getState().doc.layers[0] as QrLayer).payload).toBe("destination-cafe");
  });

  it("does not query for a one-character search", async () => {
    const engine = new EditorEngine(qrDocument());
    engine.select("qr-1");
    render(<InspectorPanel engine={engine} businessSlug="own-business" />);

    fireEvent.change(screen.getByPlaceholderText("نام کسب‌وکار، دسته‌بندی یا شهر"), {
      target: { value: "ک" },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(mockSearchBusinesses).not.toHaveBeenCalled();
  });
});
