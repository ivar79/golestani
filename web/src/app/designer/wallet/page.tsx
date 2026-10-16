"use client";

/**
 * /designer/wallet — کیف پول طراح (تسویهٔ دستی)
 *
 * What the designer owns and sees:
 *   - موجودی، مبلغ در انتظار پرداخت و «قابل برداشت» (همه به تومان نمایش داده
 *     می‌شوند؛ واحد سمت سرور ریال است و تبدیل فقط با lib/money انجام می‌شود)؛
 *   - متن تسویه و زمان پیش‌فرض تسویه که ADMIN در پنل خود تعیین کرده (هیچ متنی
 *     اینجا هاردکد نیست) + تاریخ پیش‌بینی‌شدهٔ واریزِ درخواست باز؛
 *   - شماره شبای ثبت‌شده با کد پیامکی (OTP) — تغییر شبا تا پایان مدت انتظار،
 *     درخواست برداشت را قفل می‌کند و همان زمان به کاربر گفته می‌شود؛
 *   - ثبت درخواست برداشت، لغو درخواست در انتظار، و تاریخچهٔ درخواست‌ها و
 *     دفتر کل (ledger) به‌صورت فقط-خواندنی.
 *
 * پرداخت واقعی خارج از سامانه انجام می‌شود؛ این صفحه فقط ثبت و پیگیری است.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Copy,
  Check,
  History,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import api, { extractApiError } from "@/lib/api";
import AppTaskbar from "@/components/layout/AppTaskbar";
import { formatToman, tomanFromRial, tomanToRial } from "@/lib/money";

type Settlement = {
  note: string;
  days: number;
  withdrawals_enabled: boolean;
  min_amount_rial: number;
  bank_change_cooldown_hours: number;
};

type BankAccount = {
  sheba: string;
  sheba_masked: string;
  owner_name: string;
  bank_changed_at: string | null;
  withdrawable_from: string | null;
};

type Withdrawal = {
  id: number;
  amount: number;
  status: "pending" | "approved" | "paid" | "rejected" | "cancelled";
  sheba: string;
  sheba_masked: string;
  owner_name: string;
  admin_note: string | null;
  payment_reference: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  expected_paid_at: string | null;
  expected_paid_at_jalali: string | null;
};

type WalletPayload = {
  wallet: { balance: number; pending_balance: number; withdrawable: number; currency: string };
  min_amount_rial: number;
  settlement: Settlement;
  bank_account: BankAccount | null;
  open_request: Withdrawal | null;
};

type LedgerRow = {
  id: number;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string | null;
};

const STATUS_LABELS: Record<Withdrawal["status"], string> = {
  pending: "در انتظار بررسی",
  approved: "تأییدشده — در صف واریز",
  paid: "پرداخت‌شده",
  rejected: "ردشده",
  cancelled: "لغوشده",
};

const STATUS_STYLES: Record<Withdrawal["status"], string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  paid: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  cancelled: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

const LEDGER_LABELS: Record<string, string> = {
  commission_accrued: "پورسانت خرید",
  commission_reversed: "برگشت پورسانت",
  withdrawal_hold: "نگه‌داشت مبلغ برداشت",
  withdrawal_released: "آزادسازی مبلغ برداشت",
  withdrawal_paid: "پرداخت برداشت",
  adjustment: "اصلاح توسط پشتیبانی",
};

const num = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
const rial = (amount: number | null | undefined) => formatToman(tomanFromRial(amount ?? 0));
const formatDate = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value)) : "—";

export default function DesignerWalletPage() {
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState<WalletPayload | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Payout request form (toman, like every amount the user types).
  const [amountToman, setAmountToman] = useState("");

  // Bank account (OTP-gated) form.
  const [sheba, setSheba] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wallet, ledgerResponse, history] = await Promise.all([
        api.get<WalletPayload>("/designer/wallet"),
        api.get<{ data: LedgerRow[] }>("/designer/wallet/transactions"),
        api.get<{ data: Withdrawal[] }>("/designer/wallet/withdrawals"),
      ]);
      setData(wallet.data);
      setLedger(ledgerResponse.data.data);
      setWithdrawals(history.data.data);
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, user, load]);

  async function requestWithdrawal() {
    const toman = Number(amountToman.replace(/[^\d]/g, ""));
    if (!Number.isFinite(toman) || toman <= 0) {
      setMessage({ text: "مبلغ درخواست را به تومان و بزرگ‌تر از صفر وارد کنید.", error: true });
      return;
    }
    setBusy("request");
    setMessage(null);
    try {
      await api.post("/designer/wallet/withdrawals", { amount: tomanToRial(toman) });
      setAmountToman("");
      setMessage({ text: "درخواست برداشت ثبت شد و مبلغ آن تا بررسی، در انتظار نگه داشته می‌شود." });
      await load();
    } catch (requestError) {
      setMessage({ text: extractApiError(requestError), error: true });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function cancelWithdrawal(id: number) {
    if (!window.confirm("این درخواست لغو شود؟ مبلغ آن به موجودی قابل برداشت شما بازمی‌گردد.")) return;
    setBusy("cancel");
    setMessage(null);
    try {
      await api.delete(`/designer/wallet/withdrawals/${id}`);
      setMessage({ text: "درخواست لغو شد و مبلغ به موجودی قابل برداشت بازگشت." });
      await load();
    } catch (requestError) {
      setMessage({ text: extractApiError(requestError), error: true });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function sendOtp() {
    setBusy("otp");
    setMessage(null);
    try {
      await api.post("/designer/wallet/bank-account/otp");
      setOtpSent(true);
      setMessage({ text: "کد تأیید به شماره موبایل شما پیامک شد." });
    } catch (requestError) {
      setMessage({ text: extractApiError(requestError), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function saveBankAccount() {
    setBusy("bank");
    setMessage(null);
    try {
      await api.put("/designer/wallet/bank-account", { sheba: sheba.trim(), owner_name: ownerName.trim(), code: code.trim() });
      setSheba("");
      setOwnerName("");
      setCode("");
      setOtpSent(false);
      setMessage({ text: "شماره شبا ثبت شد. اگر شبا را تغییر داده باشید، تا پایان مدت انتظار امکان ثبت درخواست برداشت ندارید." });
      await load();
    } catch (requestError) {
      setMessage({ text: extractApiError(requestError), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function copySheba(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090d16] text-slate-300">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-[#0f172a] px-6 py-4">
          <RefreshCw className="h-5 w-5 animate-spin text-cyan-400" />
          <span>در حال بررسی حساب کاربری…</span>
        </div>
      </main>
    );
  }

  // Signed out: the same sign-in card the designer panel shows (no silent blank).
  if (!user) {
    return (
      <main className="min-h-screen bg-[#050B14] px-4 pt-28 text-white" dir="rtl">
        <AppTaskbar />
        <div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#0c1626]/80 p-8 text-center backdrop-blur-xl">
          <Wallet className="mx-auto h-12 w-12 text-cyan-400 opacity-80" />
          <h2 className="mt-4 text-xl font-bold">ورود به کیف پول طراح</h2>
          <p className="mt-2 text-sm text-slate-400">برای مشاهدهٔ موجودی، ثبت شبای واریز و درخواست برداشت، لطفاً وارد شوید.</p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-cyan-500 px-6 py-3 font-bold text-slate-950 transition hover:bg-cyan-400">
            ورود به سیستم
          </Link>
        </div>
      </main>
    );
  }

  // The wallet API is designer-only (admins too): a plain user sees a clear
  // message instead of an empty 403 screen.
  const canUseWallet = user.roles.includes("designer") || user.roles.includes("admin");
  if (!canUseWallet) {
    return (
      <main className="min-h-screen bg-[#090d16]" dir="rtl">
        <AppTaskbar />
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm leading-7 text-amber-200">
            کیف پول پورسانت برای حساب‌های طراح فعال است. برای فعال‌سازی، از پنل طراح درخواست برنامهٔ طراحی را ثبت کنید.
          </p>
          <Link href="/designer" className="mt-4 inline-block rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:text-white">
            رفتن به پنل طراح
          </Link>
        </div>
      </main>
    );
  }

  const settlement = data?.settlement;
  const openRequest = data?.open_request ?? null;
  const cooldownUntil = data?.bank_account?.withdrawable_from ?? null;
  const minimumToman = tomanFromRial(settlement?.min_amount_rial ?? data?.min_amount_rial ?? 0);
  const withdrawalsOpen = settlement?.withdrawals_enabled !== false && cooldownUntil === null;

  return (
    <main className="min-h-screen bg-[#090d16] text-slate-200" dir="rtl">
      <AppTaskbar />

      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-white">
              <Wallet className="h-5 w-5 text-cyan-400" />
              کیف پول و تسویه
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              پورسانت فروش‌های منتسب به شما در همین کیف پول ثبت می‌شود؛ واریز به‌صورت دستی و پس از تأیید انجام می‌شود.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/designer"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:text-white"
            >
              پنل طراح
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              تازه‌سازی
            </button>
          </div>
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
            className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
              message.error ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {message.error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            {message.text}
          </div>
        )}

        {/* SETTLEMENT CONTRACT — configured by the admin, never hardcoded here. */}
        {settlement && (
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-cyan-200">
              <CalendarClock className="h-4 w-4" />
              شرایط تسویه
            </p>
            <p className="mt-2 text-sm leading-7 text-cyan-100">{settlement.note || "زمان‌بندی تسویه توسط مدیر سامانه تعیین می‌شود."}</p>
            <p className="mt-2 text-[11px] text-cyan-200/80">
              زمان تقریبی واریز پس از تأیید: {num(settlement.days)} روز · حداقل مبلغ برداشت: {rial(settlement.min_amount_rial)} · ثبت درخواست
              برداشت: {settlement.withdrawals_enabled ? "فعال" : "غیرفعال"}
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] text-slate-400">موجودی قابل برداشت</p>
                <p className="mt-1 text-lg font-bold text-white">{rial(data?.wallet.withdrawable)}</p>
                <p className="mt-1 text-[11px] text-slate-500">موجودی کل: {rial(data?.wallet.balance)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] text-slate-400">در انتظار پرداخت</p>
                <p className="mt-1 text-lg font-bold text-amber-300">{rial(data?.wallet.pending_balance)}</p>
                <p className="mt-1 text-[11px] text-slate-500">مبلغ درخواست‌های باز</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] text-slate-400">وضعیت ثبت درخواست</p>
                <p className={`mt-1 text-lg font-bold ${withdrawalsOpen ? "text-emerald-300" : "text-rose-300"}`}>
                  {withdrawalsOpen ? "آماده ثبت" : "فعلاً غیرفعال"}
                </p>
                {cooldownUntil && <p className="mt-1 text-[11px] text-rose-300">پس از تغییر شبا تا {formatDate(cooldownUntil)} امکان‌پذیر نیست.</p>}
              </div>
            </div>

            {openRequest && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-200">
                  <Banknote className="h-4 w-4" />
                  درخواست باز شما: {rial(openRequest.amount)}
                </p>
                <p className="mt-2 text-[11px] leading-6 text-slate-300">
                  وضعیت: {STATUS_LABELS[openRequest.status]} · ثبت: {formatDate(openRequest.requested_at)}
                  {openRequest.expected_paid_at_jalali && <> · تاریخ پیش‌بینی‌شدهٔ واریز: <span className="text-amber-200">{openRequest.expected_paid_at_jalali}</span></>}
                </p>
                {openRequest.admin_note && <p className="mt-1 text-[11px] text-slate-400">یادداشت مدیر: {openRequest.admin_note}</p>}
                {openRequest.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => void cancelWithdrawal(openRequest.id)}
                    disabled={busy !== null}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-400/20 disabled:opacity-50"
                  >
                    {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    لغو درخواست
                  </button>
                )}
              </div>
            )}

            {/* Payout request */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-bold text-white">درخواست برداشت</p>
              <p className="mt-1 text-[11px] text-slate-400">
                مبلغ به تومان وارد می‌شود و به شماره شبای ثبت‌شده واریز می‌گردد. حداقل مبلغ: {formatToman(minimumToman)}
              </p>
              {cooldownUntil && (
                <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  شماره شبای شما به‌تازگی تغییر کرده است؛ ثبت درخواست برداشت از {formatDate(cooldownUntil)} امکان‌پذیر است.
                </p>
              )}
              {settlement && !settlement.withdrawals_enabled && (
                <p className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-300">
                  ثبت درخواست برداشت توسط مدیر سامانه موقتاً غیرفعال شده است.
                </p>
              )}
              {!data?.bank_account && (
                <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  برای ثبت درخواست، ابتدا شماره شبای خود را در همین صفحه ثبت کنید.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-400">مبلغ (تومان)</span>
                  <input
                    value={amountToman}
                    onChange={(event) => setAmountToman(event.target.value)}
                    inputMode="numeric"
                    placeholder={num(minimumToman)}
                    className="w-48 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void requestWithdrawal()}
                  disabled={busy !== null || !withdrawalsOpen || !data?.bank_account || (data?.wallet.withdrawable ?? 0) <= 0}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "request" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                  ثبت درخواست
                </button>
              </div>
            </div>

            {/* Bank account */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-white">
                <Landmark className="h-4 w-4 text-cyan-400" />
                شماره شبای واریز
              </p>
              {data?.bank_account ? (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-white" dir="ltr">{data.bank_account.sheba}</span>
                    <button
                      type="button"
                      onClick={() => void copySheba(data.bank_account!.sheba)}
                      className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "کپی شد" : "کپی"}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">صاحب حساب: {data.bank_account.owner_name}</p>
                  <p className="text-[11px] text-slate-500">
                    آخرین تغییر: {formatDate(data.bank_account.bank_changed_at)} · تغییر شبا با کد پیامکی انجام می‌شود.
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">شماره شبایی ثبت نشده است. برای دریافت واریز، آن را ثبت کنید.</p>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-slate-400">شماره شبا (IR و ۲۴ رقم)</span>
                  <input
                    value={sheba}
                    onChange={(event) => setSheba(event.target.value)}
                    placeholder="IR820540102680020817909002"
                    dir="ltr"
                    className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-400">نام صاحب حساب</span>
                  <input
                    value={ownerName}
                    onChange={(event) => setOwnerName(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  onClick={() => void sendOtp()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                >
                  {busy === "otp" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />}
                  ارسال کد تأیید
                </button>
                {otpSent && (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-slate-400">کد پیامکی ۵ رقمی</span>
                      <input
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        inputMode="numeric"
                        maxLength={5}
                        dir="ltr"
                        className="w-28 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-center text-sm text-white"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveBankAccount()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-50"
                    >
                      {busy === "bank" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      ثبت شبا
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* History + ledger */}
            <div className="space-y-3">
              <p className="text-sm font-bold text-white">تاریخچهٔ درخواست‌ها</p>
              {withdrawals.length === 0 ? (
                <p className="rounded-2xl border border-white/10 p-8 text-center text-sm text-slate-500">هنوز درخواست برداشتی ثبت نکرده‌اید.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full min-w-[640px] text-right text-xs">
                    <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">مبلغ</th>
                        <th className="px-4 py-3 font-semibold">وضعیت</th>
                        <th className="px-4 py-3 font-semibold">تاریخ ثبت</th>
                        <th className="px-4 py-3 font-semibold">پیش‌بینی واریز</th>
                        <th className="px-4 py-3 font-semibold">پیگیری / یادداشت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {withdrawals.map((row) => (
                        <tr key={row.id} className="text-slate-300">
                          <td className="px-4 py-3 whitespace-nowrap font-semibold text-white">{rial(row.amount)}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${STATUS_STYLES[row.status]}`}>
                              {STATUS_LABELS[row.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-400">{formatDate(row.requested_at)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-400">{row.expected_paid_at_jalali ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-400">
                            {row.payment_reference ? <span className="font-mono" dir="ltr">{row.payment_reference}</span> : null}
                            {row.admin_note ? <span className={row.payment_reference ? "mr-2" : ""}>{row.admin_note}</span> : null}
                            {!row.payment_reference && !row.admin_note ? "—" : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-bold text-white">
                <History className="h-4 w-4 text-cyan-400" />
                ریز تراکنش‌ها (فقط-خواندنی)
              </p>
              {ledger.length === 0 ? (
                <p className="rounded-2xl border border-white/10 p-8 text-center text-sm text-slate-500">تراکنشی ثبت نشده است.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full min-w-[560px] text-right text-xs">
                    <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">نوع</th>
                        <th className="px-4 py-3 font-semibold">مبلغ</th>
                        <th className="px-4 py-3 font-semibold">مانده</th>
                        <th className="px-4 py-3 font-semibold">توضیح</th>
                        <th className="px-4 py-3 font-semibold">تاریخ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {ledger.map((row) => (
                        <tr key={row.id} className="text-slate-300">
                          <td className="px-4 py-3 whitespace-nowrap">{LEDGER_LABELS[row.type] ?? row.type}</td>
                          <td className={`px-4 py-3 whitespace-nowrap font-semibold ${row.amount < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                            {rial(row.amount)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-400">{rial(row.balance_after)}</td>
                          <td className="px-4 py-3 text-slate-400">{row.description ?? "—"}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDate(row.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
