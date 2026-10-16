import api from "@/lib/api";

/**
 * ADMIN WALLET PANEL API — manual designer settlement.
 *
 * Every amount on this wire is RIAL (the ledger unit). The panel converts to
 * TOMAN for display with `tomanFromRial`/`formatToman` (lib/money.ts) — no
 * scattered ÷10 anywhere, and the min-withdrawal field is the ONE place the
 * admin types toman and the server turns it into rial.
 */

export type WalletStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled";

export type WalletSettlement = {
  note: string;
  days: number;
  withdrawals_enabled: boolean;
  min_amount_rial: number;
  bank_change_cooldown_hours: number;
};

export type WalletTotals = {
  balance: number;
  pending_balance: number;
  withdrawable: number;
  /** balance < 0: the designer owes money after a commission reversal. */
  in_debt: boolean;
  updated_at?: string | null;
};

export type WalletCommissions = {
  accrued_rial: number;
  reversed_rial: number;
  net_rial: number;
  commission_count: number;
  adjustments_rial: number;
  paid_out_rial: number;
  sales_count: number;
};

export type WalletLedgerRow = {
  id: number;
  type: string;
  type_label: string;
  amount: number;
  balance_after: number;
  description: string | null;
  subscription_id: number | null;
  reference_type: string | null;
  reference_id: number | null;
  created_at: string | null;
};

export type WithdrawalDesignerBrief = {
  id: number;
  name: string | null;
  phone: string | null;
  username: string | null;
};

export type AdminWithdrawal = {
  id: number;
  amount: number;
  amount_toman: number;
  sheba: string;
  sheba_formatted: string;
  sheba_masked: string | null;
  owner_name: string;
  status: WalletStatus;
  status_label: string;
  admin_note: string | null;
  payment_reference: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  /** The admin's ESTIMATE of the manual transfer (not the settlement itself). */
  expected_paid_at: string | null;
  expected_paid_at_jalali: string | null;
  is_open: boolean;
  is_terminal: boolean;
  admin: { id: number; name: string } | null;
  /** Present on list/queue reads only. */
  designer?: WithdrawalDesignerBrief | null;
  wallet: WalletTotals;
};

export type AdminWithdrawalDetail = {
  request: AdminWithdrawal;
  designer:
    | (WithdrawalDesignerBrief & {
        designer_status?: string;
        bank_account: {
          sheba: string;
          sheba_formatted: string;
          owner_name: string;
          bank_changed_at: string | null;
        } | null;
      })
    | null;
  wallet: WalletTotals;
  commissions: WalletCommissions;
  ledger: WalletLedgerRow[];
  other_requests: { id: number; amount: number; status: WalletStatus; status_label: string; requested_at: string | null }[];
  settlement: WalletSettlement;
};

export type WithdrawalSummary = {
  statuses: Record<WalletStatus, { count: number; amount: number }>;
  pending: number;
  approved: number;
  approved_amount: number;
  awaiting_payment_amount: number;
  settlement: WalletSettlement;
};

export type WalletSettingRow = {
  key: string;
  label: string;
  hint: string;
  type: "text" | "int" | "bool" | "toman";
  unit: string | null;
  value: string;
  default: string;
  overridden: boolean;
  value_toman?: number;
  default_toman?: number;
};

export type AdminWalletSettings = {
  settings: WalletSettingRow[];
  settlement: WalletSettlement;
  changed?: Record<string, { from: string | null; to: string | null }>;
  saved?: boolean;
};

export type AdminWalletDesignerRow = {
  id: number;
  name: string | null;
  phone: string | null;
  username: string | null;
  designer_status?: string;
  display_name?: string | null;
  referral_code?: string | null;
  wallet: WalletTotals;
  commissions: WalletCommissions;
  attributed_businesses: number;
  owned_businesses: number;
  open_requests: number;
};

export type AdminWalletDesignerDetail = {
  designer: AdminWithdrawalDetail["designer"];
  wallet: WalletTotals;
  commissions: WalletCommissions;
  ledger: WalletLedgerRow[];
  withdrawals: AdminWithdrawal[];
  businesses: { id: number; name: string; status?: string; role: "owner" | "designer" }[];
  settlement: WalletSettlement;
};

export type WithdrawalFilters = {
  status?: WalletStatus | "";
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
};

export type Paginated<T> = {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "" || value === null) return;
    search.set(key, String(value));
  });
  return search.toString();
}

export async function getWithdrawalSummary() {
  return (await api.get<WithdrawalSummary>("/admin/withdrawals/summary")).data;
}

export async function getAdminWithdrawals(filters: WithdrawalFilters = {}) {
  const query = queryString({
    status: filters.status,
    q: filters.q,
    from: filters.from,
    to: filters.to,
    page: filters.page,
    per_page: filters.per_page,
  });

  return (await api.get<Paginated<AdminWithdrawal>>(`/admin/withdrawals?${query}`)).data;
}

export async function getAdminWithdrawal(id: number) {
  return (await api.get<AdminWithdrawalDetail>(`/admin/withdrawals/${id}`)).data;
}

export type WithdrawalAction =
  | { action: "approve"; admin_note?: string; expected_paid_at?: string }
  | { action: "reject"; admin_note: string }
  | { action: "pay"; payment_reference: string };

export async function moderateAdminWithdrawal(id: number, payload: WithdrawalAction) {
  return (await api.patch<AdminWithdrawal>(`/admin/withdrawals/${id}`, payload)).data;
}

/**
 * Batch-payment CSV (نام صاحب حساب + شبای کامل + مبلغ). The blob is written
 * straight to a download, mirroring the receipt-download contract: private
 * data never becomes a public URL.
 */
export async function downloadWithdrawalsCsv(status: WalletStatus | "" = "approved"): Promise<void> {
  const query = queryString({ status });
  const response = await api.get(`/admin/withdrawals/export?${query}`, { responseType: "blob" });
  const disposition: string = response.headers?.["content-disposition"] ?? "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const asciiMatch = /filename="?([^";]+)"?/i.exec(disposition);
  let filename = `withdrawals-${status || "approved"}.csv`;
  if (utf8Match?.[1]) filename = decodeURIComponent(utf8Match[1]);
  else if (asciiMatch?.[1]) filename = asciiMatch[1];

  const blob: Blob = response.data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[/\\?%*:|"<>]/g, "-");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function getAdminWalletSettings() {
  return (await api.get<AdminWalletSettings>("/admin/wallet/settings")).data;
}

export type WalletSettingsInput = {
  settlement_note: string;
  settlement_days: number;
  /** TOMAN as typed by the admin; the server stores RIAL. */
  min_amount_toman: number;
  bank_change_cooldown_hours: number;
  withdrawals_enabled: boolean;
};

export async function saveAdminWalletSettings(values: WalletSettingsInput) {
  return (await api.put<AdminWalletSettings>("/admin/wallet/settings", { values })).data;
}

export async function getAdminWalletDesigners(params: { q?: string; page?: number; per_page?: number } = {}) {
  const query = queryString({ q: params.q, page: params.page, per_page: params.per_page });

  return (
    await api.get<
      Paginated<AdminWalletDesignerRow> & {
        totals: { balance_rial: number; pending_balance_rial: number; open_requests: number; open_requests_rial: number };
      }
    >(`/admin/wallet/designers?${query}`)
  ).data;
}

export async function getAdminWalletDesigner(id: number, ledgerLimit = 50) {
  return (
    await api.get<AdminWalletDesignerDetail>(`/admin/wallet/designers/${id}?ledger_limit=${ledgerLimit}`)
  ).data;
}

/** The ONLY way an admin moves a balance: an adjustment with a mandatory reason. */
export async function adjustDesignerWallet(id: number, amountRial: number, reason: string) {
  return (
    await api.post<{ created: boolean; wallet: WalletTotals; ledger: WalletLedgerRow[] }>(`/admin/wallets/${id}/adjust`, {
      amount: amountRial,
      reason,
    })
  ).data;
}
