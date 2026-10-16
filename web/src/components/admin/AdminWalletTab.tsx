"use client";

/**
 * AdminWalletTab — manual designer settlement, end to end.
 *
 * Three screens in one tab:
 *   1. «درخواست‌های برداشت»  the payout queue (filters + pagination) and, for a
 *      selected request, the full decision screen: complete sheba with a copy
 *      button, the designer's balance/debt/commissions, the ledger history and
 *      the three actions (تأیید / رد با دلیل / ثبت پرداخت با شماره پیگیری).
 *   2. «کیف پول طراحان»      every designer's money page + the audited
 *      adjustment form (a reason is mandatory — balances are never edited).
 *   3. «تنظیمات تسویه»      the settlement contract the ADMIN owns (this used
 *      to be config/wallet.php): settlement text, default settlement window,
 *      minimum withdrawal, bank-change cooldown and the submissions switch.
 *
 * SAFETY RAILS the UI mirrors from the API:
 *   - money is only declared settled with a tracking reference, and pay/reject
 *     ask for confirmation first;
 *   - every action button locks while its request is in flight (no double
 *     submit), and all of them lock for a terminal request;
 *   - a 422 caused by ANOTHER admin changing the same row is shown verbatim and
 *     the screen reloads, so the admin always re-decides on live data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  Download,
  History,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { extractApiError } from "@/lib/api";
import { formatToman, tomanFromRial, tomanToRial } from "@/lib/money";
import {
  adjustDesignerWallet,
  downloadWithdrawalsCsv,
  getAdminWalletDesigner,
  getAdminWalletDesigners,
  getAdminWalletSettings,
  getAdminWithdrawal,
  getAdminWithdrawals,
  getWithdrawalSummary,
  moderateAdminWithdrawal,
  saveAdminWalletSettings,
  type AdminWalletDesignerDetail,
  type AdminWalletDesignerRow,
  type AdminWalletSettings,
  type AdminWithdrawal,
  type AdminWithdrawalDetail,
  type WalletLedgerRow,
  type WalletSettingRow,
  type WalletStatus,
  type WithdrawalSummary,
} from "@/lib/adminWallet";

type View = "queue" | "designers" | "settings";

const VIEWS: { key: View; label: string; icon: typeof Wallet }[] = [
  { key: "queue", label: "درخواست‌های برداشت", icon: Banknote },
  { key: "designers", label: "کیف پول طراحان", icon: Users },
  { key: "settings", label: "تنظیمات تسویه", icon: Settings2 },
];

const STATUS_FILTERS: { key: WalletStatus | ""; label: string }[] = [
  { key: "pending", label: "در انتظار بررسی" },
  { key: "approved", label: "تأییدشده" },
  { key: "paid", label: "پرداخت‌شده" },
  { key: "rejected", label: "ردشده" },
  { key: "cancelled", label: "لغوشده" },
  { key: "", label: "همه" },
];

const STATUS_STYLES: Record<WalletStatus, string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  paid: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  cancelled: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

const num = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
/** EVERY amount crossing this panel is RIAL; it is displayed in TOMAN. */
const rial = (amount: number | null | undefined) => formatToman(tomanFromRial(amount ?? 0));
const formatDate = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value)) : "—";
const formatDateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "—";
const todayInput = () => new Date().toISOString().slice(0, 10);

function StatusBadge({ status, label }: { status: WalletStatus; label?: string }) {
  return (
    <span className={`rounded-lg border px-2 py-1 text-[11px] font-bold whitespace-nowrap ${STATUS_STYLES[status]}`}>
      {label ?? status}
    </span>
  );
}

function Card({ label, value, hint, tone = "slate" }: { label: string; value: string; hint?: string; tone?: "slate" | "amber" | "emerald" | "rose" }) {
  const tones = {
    slate: "border-white/10 text-white",
    amber: "border-amber-400/30 text-amber-300",
    emerald: "border-emerald-400/30 text-emerald-300",
    rose: "border-rose-400/30 text-rose-300",
  } as const;
  return (
    <div className={`rounded-2xl border bg-white/[0.03] p-4 ${tones[tone]}`}>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function CopySheba({ sheba, formatted }: { sheba: string; formatted?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sheba);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm text-white" dir="ltr">
        {formatted ?? sheba}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "کپی شد" : "کپی شبا"}
      </button>
    </div>
  );
}

function LedgerTable({ rows }: { rows: WalletLedgerRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-white/10 p-6 text-center text-xs text-slate-500">تراکنشی در دفتر کل ثبت نشده است.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[620px] text-right text-[11px]">
        <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400">
          <tr>
            <th className="px-3 py-2 font-semibold">نوع</th>
            <th className="px-3 py-2 font-semibold">مبلغ</th>
            <th className="px-3 py-2 font-semibold">مانده پس از ثبت</th>
            <th className="px-3 py-2 font-semibold">توضیح</th>
            <th className="px-3 py-2 font-semibold">تاریخ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((row) => (
            <tr key={row.id} className="text-slate-300">
              <td className="px-3 py-2 whitespace-nowrap">{row.type_label}</td>
              <td className={`px-3 py-2 whitespace-nowrap font-semibold ${row.amount < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                {rial(row.amount)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-400">{rial(row.balance_after)}</td>
              <td className="px-3 py-2 text-slate-400">{row.description ?? "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatDateTime(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Payout queue + decision screen                                    */
/* ------------------------------------------------------------------ */

function QueueView() {
  const [summary, setSummary] = useState<WithdrawalSummary | null>(null);
  const [status, setStatus] = useState<WalletStatus | "">("pending");
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminWithdrawalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [busy, setBusy] = useState<"approve" | "reject" | "pay" | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getWithdrawalSummary());
    } catch {
      // The summary is decoration for the header; a failure must not blank the queue.
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAdminWithdrawals({ status, q: query, from, to, page, per_page: 25 });
      setRows(result.data);
      setMeta({ total: result.total, last_page: result.last_page });
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, query, from, to, page]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      setDetail(await getAdminWithdrawal(id));
      setError(null);
    } catch (requestError) {
      setDetail(null);
      setError(extractApiError(requestError));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSummary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  /**
   * Opening a request RESETS the action forms: a reason typed for request #1
   * must never be submitted against request #2. Done in the handler (not in an
   * effect) so the panel renders once, with consistent state.
   */
  function openRequest(id: number) {
    setSelectedId(id);
    setDetail(null);
    setNote("");
    setReason("");
    setReference("");
    setExpectedDate("");
    setActionMessage(null);
    void loadDetail(id);
  }

  function closeRequest() {
    setSelectedId(null);
    setDetail(null);
  }

  async function reloadAll() {
    await Promise.all([loadQueue(), loadSummary(), selectedId === null ? Promise.resolve() : loadDetail(selectedId)]);
  }

  async function runAction(action: "approve" | "reject" | "pay") {
    if (selectedId === null) return;

    if (action === "reject") {
      if (reason.trim().length < 3) {
        setActionMessage({ text: "برای رد درخواست، ثبت دلیل (حداقل ۳ نویسه) الزامی است.", error: true });
        return;
      }
      if (!window.confirm("این درخواست رد شود؟ مبلغ نگه‌داشته‌شده به موجودی قابل برداشت طراح بازمی‌گردد و این کار قطعی است.")) return;
    }

    if (action === "pay") {
      if (reference.trim() === "") {
        setActionMessage({ text: "برای ثبت پرداخت، شماره پیگیری واریز الزامی است.", error: true });
        return;
      }
      if (!window.confirm("پرداخت این درخواست با شماره پیگیری ثبت شود؟ پس از ثبت، وضعیت «پرداخت‌شده» قطعی است.")) return;
    }

    setBusy(action);
    setActionMessage(null);
    try {
      await moderateAdminWithdrawal(selectedId, {
        action,
        ...(action === "approve" ? { admin_note: note.trim() || undefined, expected_paid_at: expectedDate || undefined } : {}),
        ...(action === "reject" ? { admin_note: reason.trim() } : {}),
        ...(action === "pay" ? { payment_reference: reference.trim() } : {}),
      } as Parameters<typeof moderateAdminWithdrawal>[1]);

      setActionMessage({
        text:
          action === "approve"
            ? "درخواست تأیید شد و در صف پرداخت دستی قرار گرفت."
            : action === "reject"
              ? "درخواست رد شد و مبلغ به موجودی طراح بازگشت."
              : "پرداخت دستی ثبت شد.",
      });
      setNote("");
      setReason("");
      setReference("");
      setExpectedDate("");
      await reloadAll();
    } catch (requestError) {
      // A 422 here is usually "another admin already moved this request": the
      // server message names the live state, and we reload so the admin sees it.
      setActionMessage({ text: extractApiError(requestError), error: true });
      await reloadAll();
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      await downloadWithdrawalsCsv(status === "" ? "approved" : status);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setExporting(false);
    }
  }

  const request = detail?.request ?? null;
  const canAct = request !== null && request.is_open && !request.is_terminal;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="در انتظار بررسی"
          value={summary ? `${num(summary.pending)} درخواست` : "—"}
          hint={summary ? rial(summary.statuses.pending.amount) : undefined}
          tone={summary && summary.pending > 0 ? "amber" : "slate"}
        />
        <Card
          label="تأییدشده — در صف پرداخت"
          value={summary ? `${num(summary.approved)} درخواست` : "—"}
          hint={summary ? rial(summary.approved_amount) : undefined}
          tone="slate"
        />
        <Card label="مجموع در انتظار پرداخت" value={summary ? rial(summary.awaiting_payment_amount) : "—"} tone="slate" />
        <Card
          label="زمان پیش‌فرض تسویه"
          value={summary ? `${num(summary.settlement.days)} روز` : "—"}
          hint={summary?.settlement.note || undefined}
          tone="slate"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.key || "all"}
            type="button"
            onClick={() => {
              setStatus(filter.key);
              setPage(1);
            }}
            className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
              status === filter.key
                ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
            }`}
          >
            {filter.label}
            {summary && filter.key !== "" && summary.statuses[filter.key].count > 0 && (
              <span className="mr-1.5 text-[10px] text-slate-400">{num(summary.statuses[filter.key].count)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[200px]">
          <span className="mb-1 block text-[11px] text-slate-400">جست‌وجوی نام، موبایل یا نام کاربری طراح</span>
          <div className="flex items-center gap-2">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setQuery(searchDraft.trim());
                  setPage(1);
                }
              }}
              placeholder="۰۹۱۲… یا نام طراح"
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
            <button
              type="button"
              onClick={() => {
                setQuery(searchDraft.trim());
                setPage(1);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-300 hover:text-white"
            >
              <Search className="h-3.5 w-3.5" />
              جست‌وجو
            </button>
          </div>
        </label>

        <label>
          <span className="mb-1 block text-[11px] text-slate-400">از تاریخ</span>
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          />
        </label>
        <label>
          <span className="mb-1 block text-[11px] text-slate-400">تا تاریخ</span>
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          />
        </label>

        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
          title="خروجی CSV برای پرداخت دسته‌ای"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          خروجی CSV
        </button>
        <button
          type="button"
          onClick={() => void reloadAll()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-300 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          تازه‌سازی
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-10 text-center text-sm text-slate-500">
          درخواست برداشتی با این فیلترها وجود ندارد.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[900px] text-right text-xs">
            <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">شناسه</th>
                <th className="px-4 py-3 font-semibold">طراح</th>
                <th className="px-4 py-3 font-semibold">مبلغ</th>
                <th className="px-4 py-3 font-semibold">شبا</th>
                <th className="px-4 py-3 font-semibold">وضعیت</th>
                <th className="px-4 py-3 font-semibold">تاریخ درخواست</th>
                <th className="px-4 py-3 font-semibold">پیش‌بینی واریز</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map((row) => (
                <tr key={row.id} className={selectedId === row.id ? "bg-cyan-500/[0.06]" : "text-slate-300"}>
                  <td className="px-4 py-3 font-mono text-slate-400" dir="ltr">#{row.id}</td>
                  <td className="px-4 py-3">
                    <p className="font-bold text-white">{row.designer?.name ?? "—"}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500" dir="ltr">{row.designer?.phone ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-semibold text-white">{rial(row.amount)}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-slate-400" dir="ltr">{row.sheba_masked ?? row.sheba}</td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} label={row.status_label} /></td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-400">{formatDate(row.requested_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-400">{row.expected_paid_at_jalali ?? "—"}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openRequest(row.id)}
                      className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20"
                    >
                      جزئیات و اقدام
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta.last_page > 1 && (
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 disabled:opacity-40"
          >
            صفحه قبل
          </button>
          <span>
            صفحه {num(page)} از {num(meta.last_page)} · {num(meta.total)} درخواست
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(meta.last_page, current + 1))}
            disabled={page >= meta.last_page}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 disabled:opacity-40"
          >
            صفحه بعد
          </button>
        </div>
      )}

      {selectedId !== null && (
        <div className="rounded-2xl border border-cyan-500/20 bg-white/[0.02] p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Banknote className="h-4 w-4 text-cyan-400" />
              جزئیات درخواست #{num(selectedId)}
            </h3>
            <button
              type="button"
              onClick={closeRequest}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 hover:text-white"
            >
              بستن
            </button>
          </div>

          {detailLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
            </div>
          ) : detail === null || request === null ? (
            <p className="rounded-xl border border-white/10 p-6 text-center text-xs text-slate-500">اطلاعات این درخواست در دسترس نیست.</p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card label="مبلغ درخواست" value={rial(request.amount)} tone="amber" />
                <Card
                  label="موجودی طراح"
                  value={rial(detail.wallet.balance)}
                  hint={detail.wallet.in_debt ? "این طراح بدهکار است" : `قابل برداشت: ${rial(detail.wallet.withdrawable)}`}
                  tone={detail.wallet.in_debt ? "rose" : "slate"}
                />
                <Card label="مبلغ نگه‌داشته‌شده" value={rial(detail.wallet.pending_balance)} />
                <Card
                  label="پورسانت خالص"
                  value={rial(detail.commissions.net_rial)}
                  hint={`${num(detail.commissions.commission_count)} پورسانت · ${num(detail.commissions.sales_count)} فروش منتسب`}
                  tone="emerald"
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <p className="mb-2 text-[11px] text-slate-400">صاحب حساب و شبای کامل (برای واریز دستی)</p>
                  <p className="mb-2 text-sm font-bold text-white">{request.owner_name}</p>
                  <CopySheba sheba={request.sheba} formatted={request.sheba_formatted} />
                  <p className="mt-3 text-[11px] text-slate-500">
                    طراح: {detail.designer?.name ?? "—"} · {detail.designer?.phone ?? "—"}
                    {detail.designer?.username ? ` · @${detail.designer.username}` : ""}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[11px] leading-6 text-slate-400">
                  <p className="mb-1 flex items-center gap-1.5 text-slate-300">
                    <CalendarClock className="h-3.5 w-3.5 text-cyan-400" /> زمان‌های درخواست
                  </p>
                  <p>ثبت: {formatDateTime(request.requested_at)}</p>
                  <p>بررسی: {formatDateTime(request.reviewed_at)}</p>
                  <p>پرداخت: {formatDateTime(request.paid_at)}</p>
                  <p>پیش‌بینی واریز: {request.expected_paid_at_jalali ?? "—"}</p>
                  {request.payment_reference && (
                    <p className="mt-1 font-mono text-slate-300" dir="ltr">پیگیری: {request.payment_reference}</p>
                  )}
                </div>
              </div>

              {detail.settlement.note && (
                <p className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] p-3 text-[11px] leading-6 text-cyan-200">
                  <KeyRound className="ml-1 inline h-3.5 w-3.5" />
                  متن تسویه‌ای که این طراح می‌بیند: {detail.settlement.note} (پیش‌فرض {num(detail.settlement.days)} روز)
                </p>
              )}

              {actionMessage && (
                <div
                  role="alert"
                  className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${
                    actionMessage.error
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  {actionMessage.error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  {actionMessage.text}
                </div>
              )}

              {request.is_terminal ? (
                <p className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-slate-400">
                  این درخواست در وضعیت «{request.status_label}» و قطعی است؛ هیچ اقدام دیگری روی آن امکان‌پذیر نیست.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* APPROVE — the expected payout date is optional and defaults
                      to the admin-configured settlement window. */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="mb-2 text-xs font-bold text-white">تأیید درخواست و ورود به صف پرداخت</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">یادداشت مدیر (اختیاری)</span>
                        <input
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">تاریخ پیش‌بینی‌شدهٔ واریز (اختیاری)</span>
                        <input
                          type="date"
                          min={todayInput()}
                          value={expectedDate}
                          onChange={(event) => setExpectedDate(event.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      اگر تاریخی وارد نکنید، {num(detail.settlement.days)} روز پس از تأیید ثبت می‌شود و طراح آن را در کیف پول و اعلان می‌بیند.
                    </p>
                    <button
                      type="button"
                      onClick={() => void runAction("approve")}
                      disabled={busy !== null || request.status !== "pending"}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                    >
                      {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      تأیید درخواست
                    </button>
                    {request.status !== "pending" && (
                      <p className="mt-2 text-[11px] text-slate-500">این درخواست قبلاً تأیید شده است.</p>
                    )}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {/* REJECT — reason mandatory, confirmation required. */}
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-4">
                      <p className="mb-2 text-xs font-bold text-rose-200">رد درخواست (دلیل الزامی است)</p>
                      <textarea
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        rows={2}
                        placeholder="مثلاً: شبای ثبت‌شده با نام صاحب حساب هم‌خوانی ندارد."
                        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-600"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">با رد شدن، مبلغ نگه‌داشته‌شده به موجودی قابل برداشت طراح بازمی‌گردد.</p>
                      <button
                        type="button"
                        onClick={() => void runAction("reject")}
                        disabled={busy !== null}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-400/20 disabled:opacity-50"
                      >
                        {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                        رد درخواست
                      </button>
                    </div>

                    {/* PAY — the tracking reference is the proof of settlement. */}
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                      <p className="mb-2 text-xs font-bold text-emerald-200">ثبت پرداخت دستی (شمارهٔ پیگیری الزامی است)</p>
                      <input
                        value={reference}
                        onChange={(event) => setReference(event.target.value)}
                        placeholder="شمارهٔ پیگیری پایا / اینترنت‌بانک"
                        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-600"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">پس از ثبت، وضعیت «پرداخت‌شده» قطعی است و قابل تغییر نیست.</p>
                      <button
                        type="button"
                        onClick={() => void runAction("pay")}
                        disabled={busy !== null}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
                      >
                        {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                        ثبت پرداخت
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <History className="h-4 w-4 text-cyan-400" />
                  تاریخچهٔ دفتر کل طراح
                </p>
                <LedgerTable rows={detail.ledger} />
              </div>

              {detail.other_requests.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-white">سایر درخواست‌های این طراح</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.other_requests.map((other) => (
                      <button
                        key={other.id}
                        type="button"
                        onClick={() => openRequest(other.id)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300 hover:text-white"
                      >
                        #{num(other.id)} · {rial(other.amount)} · {other.status_label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!canAct && !request.is_terminal && (
                <p className="text-[11px] text-slate-500">این درخواست در وضعیت «{request.status_label}» است.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Designer wallets + adjustment                                     */
/* ------------------------------------------------------------------ */

function DesignersView() {
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminWalletDesignerRow[]>([]);
  const [totals, setTotals] = useState<{ balance_rial: number; pending_balance_rial: number; open_requests: number; open_requests_rial: number } | null>(null);
  const [meta, setMeta] = useState({ total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminWalletDesignerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [amountToman, setAmountToman] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAdminWalletDesigners({ q: query, page, per_page: 25 });
      setRows(result.data);
      setTotals(result.totals);
      setMeta({ total: result.total, last_page: result.last_page });
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      setDetail(await getAdminWalletDesigner(id));
      setError(null);
    } catch (requestError) {
      setDetail(null);
      setError(extractApiError(requestError));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /** Same contract as the queue: the adjustment form resets per designer. */
  function openDesigner(id: number) {
    setSelectedId(id);
    setDetail(null);
    setAmountToman("");
    setReason("");
    setMessage(null);
    void loadDetail(id);
  }

  function closeDesigner() {
    setSelectedId(null);
    setDetail(null);
  }

  async function submitAdjustment() {
    if (selectedId === null) return;
    const toman = Number(amountToman.replace(/[^\d-]/g, ""));
    if (!Number.isFinite(toman) || toman === 0) {
      setMessage({ text: "مبلغ اصلاح را وارد کنید (منفی برای کسر از موجودی).", error: true });
      return;
    }
    if (reason.trim().length < 3) {
      setMessage({ text: "دلیل اصلاح الزامی است (حداقل ۳ نویسه).", error: true });
      return;
    }
    if (!window.confirm(`اصلاح موجودی به مبلغ ${formatToman(toman)} ثبت شود؟ این کار در دفتر کل و سوابق مدیریتی ثبت می‌شود.`)) return;

    setSaving(true);
    setMessage(null);
    try {
      await adjustDesignerWallet(selectedId, tomanToRial(toman), reason.trim());
      setMessage({ text: "اصلاح موجودی ثبت شد." });
      setAmountToman("");
      setReason("");
      await Promise.all([loadDetail(selectedId), load()]);
    } catch (requestError) {
      setMessage({ text: extractApiError(requestError), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="موجودی کل طراحان" value={totals ? rial(totals.balance_rial) : "—"} />
        <Card label="مبلغ نگه‌داشته‌شده (درخواست باز)" value={totals ? rial(totals.pending_balance_rial) : "—"} />
        <Card label="درخواست‌های باز" value={totals ? `${num(totals.open_requests)} درخواست` : "—"} hint={totals ? rial(totals.open_requests_rial) : undefined} />
        <Card label="تعداد طراحان" value={num(meta.total)} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[220px]">
          <span className="mb-1 block text-[11px] text-slate-400">جست‌وجوی طراح (نام، موبایل، نام کاربری)</span>
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setQuery(searchDraft.trim());
                setPage(1);
              }
            }}
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setQuery(searchDraft.trim());
            setPage(1);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-300 hover:text-white"
        >
          <Search className="h-3.5 w-3.5" />
          جست‌وجو
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-300 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          تازه‌سازی
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-10 text-center text-sm text-slate-500">طراحی با این مشخصات پیدا نشد.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[880px] text-right text-xs">
            <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">طراح</th>
                <th className="px-4 py-3 font-semibold">موجودی</th>
                <th className="px-4 py-3 font-semibold">در انتظار پرداخت</th>
                <th className="px-4 py-3 font-semibold">پورسانت خالص</th>
                <th className="px-4 py-3 font-semibold">فروش / کسب‌وکار منتسب</th>
                <th className="px-4 py-3 font-semibold">درخواست باز</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map((row) => (
                <tr key={row.id} className={selectedId === row.id ? "bg-cyan-500/[0.06]" : "text-slate-300"}>
                  <td className="px-4 py-3">
                    <p className="font-bold text-white">{row.name ?? "—"}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500" dir="ltr">{row.phone ?? "—"}</p>
                  </td>
                  <td className={`px-4 py-3 whitespace-nowrap font-semibold ${row.wallet.in_debt ? "text-rose-300" : "text-white"}`}>
                    {rial(row.wallet.balance)}
                    {row.wallet.in_debt && <span className="mr-1 text-[10px] text-rose-300">(بدهکار)</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-400">{rial(row.wallet.pending_balance)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-emerald-300">{rial(row.commissions.net_rial)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-400">
                    {num(row.commissions.sales_count)} / {num(row.attributed_businesses)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-400">
                    {row.open_requests > 0 ? <span className="text-amber-300">{num(row.open_requests)}</span> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openDesigner(row.id)}
                      className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20"
                    >
                      کیف پول و دفتر کل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta.last_page > 1 && (
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 disabled:opacity-40"
          >
            صفحه قبل
          </button>
          <span>
            صفحه {num(page)} از {num(meta.last_page)}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(meta.last_page, current + 1))}
            disabled={page >= meta.last_page}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 disabled:opacity-40"
          >
            صفحه بعد
          </button>
        </div>
      )}

      {selectedId !== null && (
        <div className="rounded-2xl border border-cyan-500/20 bg-white/[0.02] p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Wallet className="h-4 w-4 text-cyan-400" />
              کیف پول {detail?.designer?.name ?? `#${num(selectedId)}`}
            </h3>
            <button
              type="button"
              onClick={closeDesigner}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 hover:text-white"
            >
              بستن
            </button>
          </div>

          {detailLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
            </div>
          ) : detail === null ? (
            <p className="rounded-xl border border-white/10 p-6 text-center text-xs text-slate-500">اطلاعات این طراح در دسترس نیست.</p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card
                  label="موجودی"
                  value={rial(detail.wallet.balance)}
                  hint={detail.wallet.in_debt ? "بدهکار — از پورسانت‌های بعدی کسر می‌شود" : `قابل برداشت: ${rial(detail.wallet.withdrawable)}`}
                  tone={detail.wallet.in_debt ? "rose" : "slate"}
                />
                <Card label="در انتظار پرداخت" value={rial(detail.wallet.pending_balance)} />
                <Card label="پورسانت خالص" value={rial(detail.commissions.net_rial)} hint={`${num(detail.commissions.commission_count)} پورسانت`} tone="emerald" />
                <Card label="پرداخت‌شده تا امروز" value={rial(detail.commissions.paid_out_rial)} />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[11px] leading-6 text-slate-400">
                  <p className="mb-1 text-xs font-bold text-white">شناسه و حساب واریز</p>
                  <p>نام: {detail.designer?.name ?? "—"}</p>
                  <p className="font-mono" dir="ltr">{detail.designer?.phone ?? "—"}</p>
                  {detail.designer?.bank_account ? (
                    <>
                      <p>صاحب حساب: {detail.designer.bank_account.owner_name}</p>
                      <CopySheba sheba={detail.designer.bank_account.sheba} formatted={detail.designer.bank_account.sheba_formatted} />
                    </>
                  ) : (
                    <p className="text-amber-300">این طراح شماره شبایی ثبت نکرده است.</p>
                  )}
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
                  <p className="mb-2 text-xs font-bold text-amber-200">اصلاح موجودی (دلیل الزامی است)</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-slate-400">مبلغ (تومان، منفی = کسر)</span>
                      <input
                        value={amountToman}
                        onChange={(event) => setAmountToman(event.target.value)}
                        inputMode="numeric"
                        placeholder="مثلاً ۱۵۰٬۰۰۰ یا -۵۰٬۰۰۰"
                        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-slate-400">دلیل</span>
                      <input
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitAdjustment()}
                    disabled={saving}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/20 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    ثبت اصلاح
                  </button>
                  <p className="mt-2 text-[11px] text-slate-500">موجودی هرگز مستقیم ویرایش نمی‌شود؛ هر اصلاح یک ردیف دفتر کل با دلیل است.</p>
                </div>
              </div>

              {message && (
                <div
                  role="alert"
                  className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${
                    message.error ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  {message.error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  {message.text}
                </div>
              )}

              {detail.businesses.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-white">کسب‌وکارهای مرتبط (مالکیت / انتساب)</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.businesses.map((business) => (
                      <span key={business.id} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300">
                        {business.name}
                        <span className="mr-1.5 text-slate-500">{business.role === "owner" ? "مالک" : "انتساب طراح"}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <History className="h-4 w-4 text-cyan-400" />
                  دفتر کل (آخرین {num(detail.ledger.length)} ردیف)
                </p>
                <LedgerTable rows={detail.ledger} />
              </div>

              {detail.withdrawals.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-white">تاریخچهٔ درخواست‌های برداشت</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.withdrawals.map((withdrawal) => (
                      <span key={withdrawal.id} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300">
                        #{num(withdrawal.id)} · {rial(withdrawal.amount)}
                        <StatusBadge status={withdrawal.status} label={withdrawal.status_label} />
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Settlement settings (the admin owns what used to be config)        */
/* ------------------------------------------------------------------ */

function SettingsView() {
  const [settings, setSettings] = useState<AdminWalletSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [minToman, setMinToman] = useState("100000");
  const [cooldown, setCooldown] = useState("24");
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminWalletSettings();
      setSettings(data);
      const byKey = new Map(data.settings.map((row) => [row.key, row]));
      setNote(byKey.get("wallet.settlement_note")?.value ?? "");
      setDays(byKey.get("wallet.settlement_days")?.value ?? "0");
      setMinToman(String(byKey.get("wallet.min_withdrawal_rial")?.value_toman ?? 0));
      setCooldown(byKey.get("wallet.bank_change_cooldown_hours")?.value ?? "0");
      setEnabled((byKey.get("wallet.withdrawals_enabled")?.value ?? "0") === "1");
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveAdminWalletSettings({
        settlement_note: note,
        settlement_days: Number(days || 0),
        min_amount_toman: Number(minToman.replace(/[^\d]/g, "") || 0),
        bank_change_cooldown_hours: Number(cooldown || 0),
        withdrawals_enabled: enabled,
      });
      setSettings(result);
      setMessage({
        text: result.saved ? "تنظیمات ذخیره و در سوابق مدیریتی ثبت شد." : "مقداری برای تغییر وجود نداشت؛ تنظیمات بدون تغییر ماند.",
      });
      await load();
    } catch (requestError) {
      setMessage({ text: extractApiError(requestError), error: true });
    } finally {
      setSaving(false);
    }
  }

  const rowFor = (key: string): WalletSettingRow | undefined => settings?.settings.find((row) => row.key === key);
  const field = (row: WalletSettingRow | undefined) => (
    <div className="mt-1 flex items-center gap-2">
      {row?.overridden ? (
        <span className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">تغییریافته</span>
      ) : (
        <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">مقدار پیش‌فرض</span>
      )}
      {row && row.overridden && (
        <span className="text-[10px] text-slate-500">پیش‌فرض: {row.type === "toman" ? formatToman(row.default_toman ?? 0) : row.default}</span>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Settings2 className="h-5 w-5 text-cyan-400" />
          تنظیمات تسویه و برداشت
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          این مقادیر در جدول تنظیمات سامانه ذخیره می‌شوند و جای مقادیر فایل config را می‌گیرند؛ هر تغییر در سوابق مدیریتی (audit) ثبت می‌شود.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {message && (
        <div
          role="alert"
          className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${
            message.error ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {message.error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {message.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:col-span-2">
          <span className="text-sm font-semibold text-white">{rowFor("wallet.settlement_note")?.label ?? "متن تسویهٔ نمایشی برای طراح"}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">{rowFor("wallet.settlement_note")?.hint}</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          />
          {field(rowFor("wallet.settlement_note"))}
        </label>

        <label className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <span className="text-sm font-semibold text-white">{rowFor("wallet.settlement_days")?.label ?? "زمان پیش‌فرض تسویه (روز)"}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">{rowFor("wallet.settlement_days")?.hint}</span>
          <input
            type="number"
            min={0}
            max={90}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            className="mt-2 w-32 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          />
          {field(rowFor("wallet.settlement_days"))}
        </label>

        <label className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <span className="text-sm font-semibold text-white">{rowFor("wallet.min_withdrawal_rial")?.label ?? "حداقل مبلغ برداشت"}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">{rowFor("wallet.min_withdrawal_rial")?.hint}</span>
          <input
            type="number"
            min={0}
            value={minToman}
            onChange={(event) => setMinToman(event.target.value)}
            className="mt-2 w-44 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          />
          <p className="mt-1 text-[11px] text-slate-500">{formatToman(Number(minToman.replace(/[^\d]/g, "") || 0))}</p>
          {field(rowFor("wallet.min_withdrawal_rial"))}
        </label>

        <label className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <span className="text-sm font-semibold text-white">{rowFor("wallet.bank_change_cooldown_hours")?.label ?? "مدت انتظار پس از تغییر شبا (ساعت)"}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">{rowFor("wallet.bank_change_cooldown_hours")?.hint}</span>
          <input
            type="number"
            min={0}
            max={720}
            value={cooldown}
            onChange={(event) => setCooldown(event.target.value)}
            className="mt-2 w-32 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          />
          {field(rowFor("wallet.bank_change_cooldown_hours"))}
        </label>

        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <span>
            <span className="block text-sm font-semibold text-white">{rowFor("wallet.withdrawals_enabled")?.label ?? "ثبت درخواست برداشت فعال باشد"}</span>
            <span className="mt-0.5 block text-[11px] text-slate-500">{rowFor("wallet.withdrawals_enabled")?.hint}</span>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="mt-1 h-5 w-5 accent-cyan-400"
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          ذخیرهٔ تنظیمات
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          بازخوانی
        </button>
      </div>

      {settings && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[11px] leading-6 text-slate-400">
          <p className="mb-1 text-xs font-bold text-white">پیش‌نمایش قرارداد تسویه برای طراح</p>
          <p>{settings.settlement.note || "—"}</p>
          <p className="mt-2">
            زمان پیش‌فرض تسویه: {num(settings.settlement.days)} روز · حداقل برداشت: {rial(settings.settlement.min_amount_rial)} · انتظار پس از تغییر
            شبا: {num(settings.settlement.bank_change_cooldown_hours)} ساعت · ثبت درخواست:{" "}
            {settings.settlement.withdrawals_enabled ? "فعال" : "غیرفعال"}
          </p>
        </div>
      )}
    </div>
  );
}

export default function AdminWalletTab() {
  const [view, setView] = useState<View>("queue");

  const active = useMemo(() => VIEWS.find((item) => item.key === view) ?? VIEWS[0], [view]);

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <active.icon className="h-5 w-5 text-amber-400" />
          کیف پول طراحان و تسویهٔ دستی
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          پرداخت‌ها به‌صورت دستی انجام می‌شود: درخواست را تأیید کنید، در بانک واریز کنید و شمارهٔ پیگیری را ثبت کنید. موجودی‌ها فقط از طریق دفتر کل تغییر
          می‌کنند.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                isActive ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {view === "queue" && <QueueView />}
      {view === "designers" && <DesignersView />}
      {view === "settings" && <SettingsView />}
    </div>
  );
}
