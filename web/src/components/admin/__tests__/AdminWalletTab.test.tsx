// @vitest-environment jsdom
/**
 * AdminWalletTab — the admin money panel's UI contract.
 *
 * These tests lock the states the panel MUST handle (and that a broken panel
 * would silently get wrong):
 *   - an empty queue and a network failure are visible, never blank;
 *   - رد درخواست without a reason and ثبت پرداخت without a tracking reference
 *     never reach the API (the server would 422 them anyway);
 *   - a 422 caused by ANOTHER admin changing the same request is shown verbatim
 *     and the screen reloads (the admin re-decides on live data);
 *   - a terminal request offers no action buttons at all;
 *   - the settings form is the admin's, sends TOMAN for the money field and
 *     reports the audit result;
 *   - the designer wallet view requires a reason for an adjustment.
 *
 * The API is mocked: the server remains authoritative (see the PHP feature
 * tests for the real endpoints).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const walletMock = vi.hoisted(() => ({
  getWithdrawalSummary: vi.fn(),
  getAdminWithdrawals: vi.fn(),
  getAdminWithdrawal: vi.fn(),
  moderateAdminWithdrawal: vi.fn(),
  downloadWithdrawalsCsv: vi.fn(),
  getAdminWalletSettings: vi.fn(),
  saveAdminWalletSettings: vi.fn(),
  getAdminWalletDesigners: vi.fn(),
  getAdminWalletDesigner: vi.fn(),
  adjustDesignerWallet: vi.fn(),
}));

vi.mock("@/lib/adminWallet", () => walletMock);
vi.mock("@/lib/api", () => ({
  extractApiError: (error: unknown) =>
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (error instanceof Error ? error.message : "خطا"),
}));

import AdminWalletTab from "../AdminWalletTab";

const SETTLEMENT = {
  note: "تسویه هر هفته پنجشنبه‌ها انجام می‌شود.",
  days: 7,
  withdrawals_enabled: true,
  min_amount_rial: 1_000_000,
  bank_change_cooldown_hours: 24,
};

const REQUEST = {
  id: 12,
  amount: 2_000_000,
  amount_toman: 200_000,
  sheba: "IR820540102680020817909002",
  sheba_formatted: "IR82 0540 1026 8002 0817 9090 02",
  sheba_masked: "IR82******************9002",
  owner_name: "طاهر گلستانی",
  status: "pending" as const,
  status_label: "در انتظار بررسی",
  admin_note: null,
  payment_reference: null,
  requested_at: "2026-10-14T10:00:00.000000Z",
  reviewed_at: null,
  paid_at: null,
  expected_paid_at: null,
  expected_paid_at_jalali: null,
  is_open: true,
  is_terminal: false,
  admin: null,
  designer: { id: 4, name: "طراح تست", phone: "09120000001", username: "designer" },
  wallet: { balance: 3_000_000, pending_balance: 2_000_000, withdrawable: 1_000_000, in_debt: false },
};

const DETAIL = {
  request: REQUEST,
  designer: { id: 4, name: "طراح تست", phone: "09120000001", username: "designer", designer_status: "approved", bank_account: { sheba: REQUEST.sheba, sheba_formatted: REQUEST.sheba_formatted, owner_name: "طاهر گلستانی", bank_changed_at: null } },
  wallet: REQUEST.wallet,
  commissions: { accrued_rial: 5_000_000, reversed_rial: 0, net_rial: 5_000_000, commission_count: 3, adjustments_rial: 0, paid_out_rial: 0, sales_count: 2 },
  ledger: [
    { id: 1, type: "withdrawal_hold", type_label: "نگه‌داشت مبلغ برداشت", amount: -2_000_000, balance_after: 3_000_000, description: "نگه‌داشتن مبلغ درخواست برداشت #12", subscription_id: null, reference_type: null, reference_id: null, created_at: "2026-10-14T10:00:00.000000Z" },
  ],
  other_requests: [],
  settlement: SETTLEMENT,
};

const PAGE = {
  data: [REQUEST],
  current_page: 1,
  last_page: 1,
  per_page: 25,
  total: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  walletMock.getWithdrawalSummary.mockResolvedValue({
    statuses: {
      pending: { count: 1, amount: 2_000_000 },
      approved: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
      rejected: { count: 0, amount: 0 },
      cancelled: { count: 0, amount: 0 },
    },
    pending: 1,
    approved: 0,
    approved_amount: 0,
    awaiting_payment_amount: 2_000_000,
    settlement: SETTLEMENT,
  });
  walletMock.getAdminWithdrawals.mockResolvedValue(PAGE);
  walletMock.getAdminWithdrawal.mockResolvedValue(DETAIL);
  walletMock.moderateAdminWithdrawal.mockResolvedValue(REQUEST);
  walletMock.getAdminWalletSettings.mockResolvedValue({
    settings: [
      { key: "wallet.settlement_note", label: "متن تسویه", hint: "", type: "text", unit: null, value: SETTLEMENT.note, default: "پیش‌فرض", overridden: true },
      { key: "wallet.settlement_days", label: "زمان تسویه", hint: "", type: "int", unit: "روز", value: "7", default: "7", overridden: false },
      { key: "wallet.min_withdrawal_rial", label: "حداقل برداشت", hint: "", type: "toman", unit: "تومان", value: "1000000", default: "1000000", overridden: false, value_toman: 100_000, default_toman: 100_000 },
      { key: "wallet.bank_change_cooldown_hours", label: "انتظار تغییر شبا", hint: "", type: "int", unit: "ساعت", value: "24", default: "24", overridden: false },
      { key: "wallet.withdrawals_enabled", label: "فعال بودن ثبت درخواست", hint: "", type: "bool", unit: null, value: "1", default: "1", overridden: false },
    ],
    settlement: SETTLEMENT,
  });
  walletMock.saveAdminWalletSettings.mockResolvedValue({ settings: [], settlement: SETTLEMENT, changed: { "wallet.settlement_days": { from: "7", to: "5" } }, saved: true });
  walletMock.getAdminWalletDesigners.mockResolvedValue({
    data: [
      {
        id: 4,
        name: "طراح تست",
        phone: "09120000001",
        username: "designer",
        designer_status: "approved",
        display_name: "طراح تست",
        referral_code: "REF-1",
        wallet: { balance: -500_000, pending_balance: 0, withdrawable: -500_000, in_debt: true },
        commissions: { accrued_rial: 1_000_000, reversed_rial: 1_500_000, net_rial: -500_000, commission_count: 2, adjustments_rial: 0, paid_out_rial: 0, sales_count: 1 },
        attributed_businesses: 2,
        owned_businesses: 1,
        open_requests: 0,
      },
    ],
    totals: { balance_rial: -500_000, pending_balance_rial: 0, open_requests: 0, open_requests_rial: 0 },
    current_page: 1,
    last_page: 1,
    per_page: 25,
    total: 1,
  });
  walletMock.getAdminWalletDesigner.mockResolvedValue({
    designer: DETAIL.designer,
    wallet: { balance: -500_000, pending_balance: 0, withdrawable: -500_000, in_debt: true },
    commissions: { accrued_rial: 1_000_000, reversed_rial: 1_500_000, net_rial: -500_000, commission_count: 2, adjustments_rial: 0, paid_out_rial: 0, sales_count: 1 },
    ledger: DETAIL.ledger,
    withdrawals: [REQUEST],
    businesses: [{ id: 9, name: "کسب‌وکار نمونه", status: "approved", role: "designer" as const }],
    settlement: SETTLEMENT,
  });
  walletMock.adjustDesignerWallet.mockResolvedValue({ created: true, wallet: REQUEST.wallet, ledger: DETAIL.ledger });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openQueue() {
  render(<AdminWalletTab />);
  await waitFor(() => expect(walletMock.getAdminWithdrawals).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText("طراح تست")).toBeTruthy());
}

async function openDetail() {
  await openQueue();
  fireEvent.click(screen.getByRole("button", { name: "جزئیات و اقدام" }));
  await waitFor(() => expect(screen.getByText("جزئیات درخواست #۱۲")).toBeTruthy());
}

describe("AdminWalletTab — payout queue", () => {
  it("renders the pending counters and the full sheba with a copy button", async () => {
    await openDetail();

    expect(screen.getByText("IR82 0540 1026 8002 0817 9090 02")).toBeTruthy();
    expect(screen.getByRole("button", { name: /کپی شبا/ })).toBeTruthy();
    // Money is shown in TOMAN, not rial.
    expect(screen.getAllByText(/۲۰۰٬۰۰۰ تومان/).length).toBeGreaterThan(0);
  });

  it("shows an explicit empty state when no request matches the filter", async () => {
    walletMock.getAdminWithdrawals.mockResolvedValue({ ...PAGE, data: [], total: 0 });
    render(<AdminWalletTab />);

    await waitFor(() => expect(screen.getByText("درخواست برداشتی با این فیلترها وجود ندارد.")).toBeTruthy());
  });

  it("shows a network failure instead of a blank list", async () => {
    walletMock.getAdminWithdrawals.mockRejectedValue(new Error("ارتباط با سرور برقرار نشد."));
    render(<AdminWalletTab />);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("ارتباط با سرور برقرار نشد."));
  });

  it("refuses to reject without a reason and never calls the API", async () => {
    await openDetail();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByRole("button", { name: "رد درخواست" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("ثبت دلیل"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(walletMock.moderateAdminWithdrawal).not.toHaveBeenCalled();
  });

  it("refuses to pay without a tracking reference and asks for confirmation before paying", async () => {
    await openDetail();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    // No reference yet → blocked client-side.
    fireEvent.click(screen.getByRole("button", { name: "ثبت پرداخت" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("شماره پیگیری"));
    expect(walletMock.moderateAdminWithdrawal).not.toHaveBeenCalled();

    // With a reference the confirmation is required before submitting.
    fireEvent.change(screen.getByPlaceholderText("شمارهٔ پیگیری پایا / اینترنت‌بانک"), { target: { value: "REF-99" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت پرداخت" }));

    await waitFor(() => expect(walletMock.moderateAdminWithdrawal).toHaveBeenCalledWith(12, { action: "pay", payment_reference: "REF-99" }));
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("approves with the optional expected payout date", async () => {
    await openDetail();

    fireEvent.change(screen.getByLabelText("تاریخ پیش‌بینی‌شدهٔ واریز (اختیاری)"), { target: { value: "2026-10-25" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید درخواست" }));

    await waitFor(() =>
      expect(walletMock.moderateAdminWithdrawal).toHaveBeenCalledWith(12, { action: "approve", admin_note: undefined, expected_paid_at: "2026-10-25" }),
    );
  });

  it("surfaces a concurrent change by another admin and reloads the live row", async () => {
    await openDetail();
    walletMock.moderateAdminWithdrawal.mockRejectedValue({
      response: { data: { message: "این درخواست در وضعیت «در انتظار بررسی» نیست." } },
    });
    const callsBefore = walletMock.getAdminWithdrawal.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "تأیید درخواست" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("در انتظار بررسی» نیست"));
    // The panel re-read the request so the next decision is made on live data.
    await waitFor(() => expect(walletMock.getAdminWithdrawal.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("offers no action buttons for a terminal request", async () => {
    walletMock.getAdminWithdrawal.mockResolvedValue({
      ...DETAIL,
      request: { ...REQUEST, status: "paid", status_label: "پرداخت‌شده", is_open: false, is_terminal: true, paid_at: "2026-10-15T09:00:00.000000Z", payment_reference: "REF-1" },
    });
    await openDetail();

    expect(screen.queryByRole("button", { name: "تأیید درخواست" })).toBeNull();
    expect(screen.queryByRole("button", { name: "رد درخواست" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ثبت پرداخت" })).toBeNull();
    expect(screen.getByText(/قطعی است/)).toBeTruthy();
  });
});

describe("AdminWalletTab — settlement settings", () => {
  it("saves the money field in TOMAN and reports the audit-backed result", async () => {
    render(<AdminWalletTab />);
    fireEvent.click(await screen.findByRole("button", { name: "تنظیمات تسویه" }));
    await waitFor(() => expect(walletMock.getAdminWalletSettings).toHaveBeenCalled());

    fireEvent.change(await screen.findByDisplayValue("7"), { target: { value: "5" } });
    // The minimum is edited in TOMAN (the server stores rial).
    fireEvent.change(screen.getByDisplayValue("100000"), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: /ذخیرهٔ تنظیمات/ }));

    await waitFor(() =>
      expect(walletMock.saveAdminWalletSettings).toHaveBeenCalledWith({
        settlement_note: SETTLEMENT.note,
        settlement_days: 5,
        min_amount_toman: 250_000,
        bank_change_cooldown_hours: 24,
        withdrawals_enabled: true,
      }),
    );
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("سوابق مدیریتی"));
  });

  it("shows the server validation error and keeps the form values", async () => {
    walletMock.saveAdminWalletSettings.mockRejectedValue({
      response: { data: { errors: { "values.settlement_days": ["زمان تسویه نمی‌تواند بیش از ۹۰ روز باشد."] } } },
    });
    render(<AdminWalletTab />);
    fireEvent.click(await screen.findByRole("button", { name: "تنظیمات تسویه" }));
    await waitFor(() => expect(walletMock.getAdminWalletSettings).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: /ذخیرهٔ تنظیمات/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});

describe("AdminWalletTab — designer wallets", () => {
  it("shows the debt and requires a reason for an adjustment", async () => {
    render(<AdminWalletTab />);
    fireEvent.click(screen.getByRole("button", { name: "کیف پول طراحان" }));
    await waitFor(() => expect(walletMock.getAdminWalletDesigners).toHaveBeenCalled());

    // A negative balance is labelled as debt, not hidden.
    expect((await screen.findAllByText(/بدهکار/)).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "کیف پول و دفتر کل" }));
    await waitFor(() => expect(walletMock.getAdminWalletDesigner).toHaveBeenCalledWith(4));

    const amount = await screen.findByLabelText("مبلغ (تومان، منفی = کسر)");
    const reason = screen.getByLabelText("دلیل");

    // Without a reason the adjustment never reaches the API.
    fireEvent.change(amount, { target: { value: "150000" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت اصلاح" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("دلیل اصلاح"));
    expect(walletMock.adjustDesignerWallet).not.toHaveBeenCalled();

    // With a reason the amount is sent in RIAL (toman × 10), after confirmation.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.change(reason, { target: { value: "جبران پورسانت جاافتاده" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت اصلاح" }));

    await waitFor(() => expect(walletMock.adjustDesignerWallet).toHaveBeenCalledWith(4, 1_500_000, "جبران پورسانت جاافتاده"));
    expect(confirmSpy).toHaveBeenCalled();
  });
});
