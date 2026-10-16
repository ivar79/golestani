// @vitest-environment jsdom
/**
 * AdminPlansTab — the admin panel manages and REPRICES plans, including the
 * seeded designer plan (`designer-pro`): the row shows its real price and
 * capabilities, and the edit flow submits the NEW price + features through the
 * same admin API the server validates (catalog check, snapshot policy).
 *
 * UI contract only — the server remains authoritative for every write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const adminMock = vi.hoisted(() => ({
  getAdminPlans: vi.fn(),
  getAdminRevenueReport: vi.fn(),
  getEntitlementCatalog: vi.fn(),
  saveAdminPlan: vi.fn(),
  updateAdminPlan: vi.fn(),
}));
vi.mock("@/lib/admin", () => adminMock);
vi.mock("@/lib/api", () => ({
  extractApiError: (err: unknown) => (err instanceof Error ? err.message : "خطا"),
}));

import AdminPlansTab from "../AdminPlansTab";
import type { AdminPlan, EntitlementCatalogEntry } from "@/lib/admin";

const DESIGNER_PLAN: AdminPlan = {
  id: 7,
  name: "طراح حرفه‌ای",
  slug: "designer-pro",
  description: "پلن طراحان: استودیوی طراحی کارت، قالب اختصاصی و ارسال به گالری.",
  price: 399000,
  currency: "IRR",
  duration_days: 30,
  features: { designer_studio: true, custom_templates: true, card_templates: ["classic", "local"] },
  sort_order: 3,
  is_featured: false,
  is_public: true,
  is_active: true,
};

const CATALOG: EntitlementCatalogEntry[] = [
  { key: "designer_studio", type: "bool", label: "استودیو طراحی کارت", group: "کارت ویزیت", free_value: false },
  { key: "custom_templates", type: "bool", label: "قالب اختصاصی شخصی", group: "کارت ویزیت", free_value: false },
  { key: "max_layers", type: "int", label: "حداکثر لایه‌های کارت", group: "محدودیت‌ها", free_value: 60 },
];

const faNumber = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.getAdminPlans.mockResolvedValue([DESIGNER_PLAN]);
  adminMock.getAdminRevenueReport.mockResolvedValue({
    subscriptions: { total: 0, pending: 0, active: 0, revenue: 0 },
    designer_attribution: [],
  });
  adminMock.getEntitlementCatalog.mockResolvedValue({
    catalog: CATALOG,
    free_tier: { name: "Free", label: "پلن رایگان", description: "", capabilities: {} },
    policies: {},
  });
  adminMock.updateAdminPlan.mockResolvedValue(DESIGNER_PLAN);
  adminMock.saveAdminPlan.mockResolvedValue(DESIGNER_PLAN);
});

afterEach(() => {
  cleanup();
});

async function renderTab() {
  render(<AdminPlansTab />);
  await screen.findByText("طراح حرفه‌ای");
}

describe("admin plans panel — designer plan", () => {
  it("lists the designer plan with its price and designer capability editor", async () => {
    await renderTab();

    // Price is rendered in Toman, formatted for fa-IR.
    expect(screen.getByText(`${faNumber(399000)} تومان`)).toBeTruthy();
    expect(screen.getByText("designer-pro")).toBeTruthy();

    // The catalog-driven editor includes the studio capability (no key is
    // hardcoded in the panel — it comes from the server catalog).
    expect(screen.getAllByLabelText("استودیو طراحی کارت").length).toBeGreaterThan(0);
  });

  it("editing the plan shows its price and designer_studio state", async () => {
    await renderTab();

    fireEvent.click(screen.getByRole("button", { name: "ویرایش قیمت و امکانات" }));

    expect((screen.getByDisplayValue("399000") as HTMLInputElement).value).toBe("399000");
    const toggles = screen.getAllByLabelText("استودیو طراحی کارت") as HTMLInputElement[];
    expect(toggles.some((toggle) => toggle.checked)).toBe(true);
  });

  it("saving a new price submits it together with the capabilities", async () => {
    await renderTab();

    fireEvent.click(screen.getByRole("button", { name: "ویرایش قیمت و امکانات" }));
    fireEvent.change(screen.getByDisplayValue("399000"), { target: { value: "499000" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(adminMock.updateAdminPlan).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ price: 499000 }),
      ),
    );
    const [, payload] = adminMock.updateAdminPlan.mock.calls[0];
    expect(payload.features).toMatchObject({ designer_studio: true });
  });

  it("renders the designer attribution report returned by the revenue endpoint", async () => {
    adminMock.getAdminRevenueReport.mockResolvedValue({
      subscriptions: { total: 0, pending: 0, active: 0, revenue: 0 },
      designer_attribution: [
        { designer_id: 7, businesses_count: 3, designer: { id: 7, display_name: "سارا", referral_code: "sara-01" } },
        { designer_id: 9, businesses_count: 1, designer: null },
      ],
    });

    await renderTab();

    // The report is an acceptance criterion of phase 5, so the panel must
    // actually show the referred-business counts, not just fetch them.
    expect(await screen.findByText("گزارش انتساب‌های طراح")).toBeTruthy();
    expect(screen.getByText("سارا")).toBeTruthy();
    expect(screen.getByText("sara-01")).toBeTruthy();
    expect(screen.getByText(faNumber(3))).toBeTruthy();
    // A designer whose account was deleted keeps its count, labelled instead
    // of being silently dropped from the report.
    expect(screen.getByText("حساب حذف‌شده")).toBeTruthy();
  });

  it("shows an empty state when no business is attributed to a designer", async () => {
    await renderTab();

    expect(await screen.findByText("گزارش انتساب‌های طراح")).toBeTruthy();
    expect(screen.getByText("هنوز هیچ کسب‌وکاری به کد معرفی یک طراح منتسب نشده است.")).toBeTruthy();
  });

  it("refuses an empty price before calling the API", async () => {
    await renderTab();

    fireEvent.click(screen.getByRole("button", { name: "ویرایش قیمت و امکانات" }));
    fireEvent.change(screen.getByDisplayValue("399000"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    expect(await screen.findByText("قیمت پلن باید یک عدد نامنفی باشد.")).toBeTruthy();
    expect(adminMock.updateAdminPlan).not.toHaveBeenCalled();
  });
});
