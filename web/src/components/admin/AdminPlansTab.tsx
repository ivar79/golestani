"use client";

/**
 * AdminPlansTab — Plan-as-product-configuration editor.
 *
 * Everything here is ADMIN-controllable and server-validated: name, slug
 * (auto-generated, immutable after creation), description, price, currency,
 * duration, ordering, featured/visibility flags, and the full features &
 * limits map rendered DYNAMICALLY from GET /admin/entitlements/catalog.
 * No entitlement key is hardcoded in this file — adding a capability to
 * config/entitlements.php automatically adds its field to this editor.
 *
 * The server rejects unknown keys / wrong types, and active subscriptions
 * keep their own snapshot: editing a plan here affects NEW purchases only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Power,
  Sparkles,
  Star,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { extractApiError } from "@/lib/api";
import {
  getAdminPlans,
  getAdminRevenueReport,
  getEntitlementCatalog,
  saveAdminPlan,
  updateAdminPlan,
  type AdminPlan,
  type EntitlementCatalogEntry,
} from "@/lib/admin";

type Draft = {
  name: string;
  description: string;
  price: string;
  /** درصد پورسانت طراح برای هر خرید این پلن (۰ = بدون پورسانت). */
  commission_percent: string;
  currency: string;
  duration_days: string;
  is_public: boolean;
  is_featured: boolean;
  is_active: boolean;
  features: Record<string, unknown>;
};

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  price: "",
  commission_percent: "0",
  currency: "IRR",
  duration_days: "30",
  is_public: true,
  is_featured: false,
  is_active: true,
  features: {},
});

const toman = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;

/**
 * «درصد پورسانت طراح» از ورودی متنی → عدد صحیح ۰..۱۰۰ (null = نامعتبر).
 * خالی یعنی صفر: پلنی که پورسانت ندارد نباید ادمین را مجبور به تایپ ۰ کند.
 */
function commissionFrom(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.floor(value);
}

/** One catalog-driven control: bool -> checkbox, int -> number (empty = unlimited), list -> comma text. */
function FeatureField({
  entry,
  value,
  onChange,
}: {
  entry: EntitlementCatalogEntry;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (entry.type === "bool") {
    const checked = value === true;
    return (
      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm hover:border-white/20">
        <span className={checked ? "font-semibold text-emerald-300" : "text-slate-300"}>{entry.label}</span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-emerald-400" />
      </label>
    );
  }
  if (entry.type === "int") {
    // null = unlimited; empty input maps to null.
    const raw = value === null || value === undefined ? "" : String(value);
    return (
      <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm hover:border-white/20">
        <span className="text-slate-300">{entry.label}</span>
        <input
          type="number"
          min={0}
          value={raw}
          placeholder="∞"
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
          className="w-20 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-center text-sm text-white"
        />
      </label>
    );
  }
  // list: comma-separated values, validated server-side against the editor contract.
  const raw = Array.isArray(value) ? value.join(", ") : "";
  return (
    <label className="block rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm hover:border-white/20">
      <span className="mb-1 block text-slate-300">
        {entry.label} <span className="text-[10px] text-slate-500">با کاما جدا کنید</span>
      </span>
      <input
        value={raw}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-xs text-white"
        dir="ltr"
      />
    </label>
  );
}

export default function AdminPlansTab() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [catalog, setCatalog] = useState<EntitlementCatalogEntry[]>([]);
  const [report, setReport] = useState<Awaited<ReturnType<typeof getAdminRevenueReport>> | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editFeatures, setEditFeatures] = useState<Record<string, unknown>>({});
  // Repricing an EXISTING plan (the API always supported it; the editor
  // surfaces it too so "price the designer plan" is a panel action).
  const [editPrice, setEditPrice] = useState<string>("");
  // Commission share of every purchase of the plan (the designer referral
  // percentage read at accrual time — editing it affects FUTURE purchases only).
  const [editCommission, setEditCommission] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const grouped = useMemo(() => {
    const map = new Map<string, EntitlementCatalogEntry[]>();
    for (const entry of catalog) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()];
  }, [catalog]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [planRows, revenue, catalogResponse] = await Promise.all([
        getAdminPlans(),
        getAdminRevenueReport(),
        getEntitlementCatalog(),
      ]);
      setPlans(planRows);
      setReport(revenue);
      setCatalog(catalogResponse.catalog);
      setError(null);
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function create() {
    if (!draft.name.trim() || !draft.price) {
      setError("نام و قیمت پلن الزامی است.");
      return;
    }
    const commission = commissionFrom(draft.commission_percent);
    if (commission === null) {
      setError("درصد پورسانت طراح باید عددی بین ۰ تا ۱۰۰ باشد.");
      return;
    }
    try {
      await saveAdminPlan({
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        price: Number(draft.price),
        currency: draft.currency,
        duration_days: Number(draft.duration_days),
        commission_percent: commission,
        features: draft.features,
        sort_order: plans.length,
        is_public: draft.is_public,
        is_featured: draft.is_featured,
        is_active: draft.is_active,
      });
      setDraft(emptyDraft());
      setNotice("پلن ساخته شد — خریداران جدید همین پیکربندی را دریافت می‌کنند.");
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    }
  }

  async function startEdit(plan: AdminPlan) {
    setEditingId(plan.id);
    setEditFeatures({ ...(plan.features ?? {}) });
    setEditPrice(String(plan.price));
    setEditCommission(String(plan.commission_percent ?? 0));
    setNotice(null);
  }

  async function saveFeatures(plan: AdminPlan) {
    const price = Number(editPrice);
    if (!editPrice.trim() || !Number.isFinite(price) || price < 0) {
      setError("قیمت پلن باید یک عدد نامنفی باشد.");
      return;
    }
    const commission = commissionFrom(editCommission);
    if (commission === null) {
      setError("درصد پورسانت طراح باید عددی بین ۰ تا ۱۰۰ باشد.");
      return;
    }
    try {
      await updateAdminPlan(plan.id, { features: editFeatures, price: Math.floor(price), commission_percent: commission });
      setEditingId(null);
      setNotice("قیمت، پورسانت و امکانات پلن ذخیره شد — اشتراک‌های فعالِ موجود snapshot خود را نگه می‌دارند.");
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    }
  }

  async function patch(plan: AdminPlan, data: Partial<AdminPlan>) {
    try {
      await updateAdminPlan(plan.id, data);
      await refresh();
    } catch (requestError) {
      setError(extractApiError(requestError));
    }
  }

  async function move(plan: AdminPlan, direction: -1 | 1) {
    const order = [...plans].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.price - b.price);
    const index = order.findIndex((p) => p.id === plan.id);
    const swapWith = order[index + direction];
    if (!swapWith) return;
    await Promise.all([
      patch(plan, { sort_order: swapWith.sort_order ?? index + direction }),
      patch(swapWith, { sort_order: plan.sort_order ?? index }),
    ]);
  }

  async function toggleActive(plan: AdminPlan) {
    // Deactivating blocks NEW purchases only — existing subscriptions stay valid.
    await patch(plan, { is_active: !plan.is_active });
  }

  return (
    <div className="space-y-6 text-right">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <CreditCard className="h-5 w-5 text-emerald-400" />
          پلن‌ها، قیمت‌گذاری و امکانات
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          پلن‌ها پیکربندی محصول هستند: قیمت، مدت، امکانات و محدودیت‌ها بدون تغییر کد قابل مدیریت‌اند.
        </p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{notice}</div>}

      {report && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["کل درخواست‌ها", report.subscriptions.total],
            ["در انتظار بررسی", report.subscriptions.pending],
            ["فعال", report.subscriptions.active],
            ["درآمد (از snapshot)", `${new Intl.NumberFormat("fa-IR").format(report.subscriptions.revenue)} تومان`],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-2 text-xl font-black text-white">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Create form — identity/pricing + catalog-driven feature editor */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <Plus className="h-4 w-4 text-emerald-400" />
          پلن جدید
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-slate-300">
            نام پلن
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white" />
          </label>
          <label className="text-xs text-slate-300">
            قیمت (تومان)
            <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} type="number" min="0" className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white" />
          </label>
          <label className="text-xs text-slate-300">
            مدت (روز)
            <input value={draft.duration_days} onChange={(e) => setDraft({ ...draft, duration_days: e.target.value })} type="number" min="1" className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white" />
          </label>
          <label className="text-xs text-slate-300">
            پورسانت طراح (٪)
            <input
              value={draft.commission_percent}
              onChange={(e) => setDraft({ ...draft, commission_percent: e.target.value })}
              type="number"
              min="0"
              max="100"
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white"
            />
            <span className="mt-1 block text-[10px] leading-4 text-slate-500">
              درصدی که طراح منتسب از هر خرید این پلن دریافت می‌کند؛ ۰ یعنی بدون پورسانت.
            </span>
          </label>
          <label className="text-xs text-slate-300 sm:col-span-2 lg:col-span-3">
            توضیحات
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={draft.is_featured} onChange={(e) => setDraft({ ...draft, is_featured: e.target.checked })} className="h-4 w-4 accent-amber-400" />
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            پیشنهاد ویژه
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={draft.is_public} onChange={(e) => setDraft({ ...draft, is_public: e.target.checked })} className="h-4 w-4 accent-cyan-400" />
            نمایش در صفحه قیمت
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} className="h-4 w-4 accent-emerald-400" />
            <Power className="h-3.5 w-3.5" />
            فعال (قابل خرید)
          </label>
          <button type="button" onClick={() => void create()} className="ms-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-300">
            <Plus className="h-4 w-4" />
            ایجاد پلن
          </button>
        </div>

        {/* Catalog-driven feature editor for the NEW plan */}
        {grouped.map(([group, entries]) => (
          <div key={group} className="mt-4 rounded-xl border border-white/5 bg-white/[0.01] p-3">
            <p className="mb-2 text-[11px] font-black text-slate-400">{group}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map((entry) => (
                <FeatureField
                  key={entry.key}
                  entry={entry}
                  value={draft.features[entry.key] ?? entry.free_value}
                  onChange={(next) => setDraft((d) => ({ ...d, features: { ...d.features, [entry.key]: next } }))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Plans table */}
      {loading ? (
        <div className="flex h-28 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-white/[0.04] text-xs text-slate-400">
              <tr>
                <th className="p-3 text-right">پلن</th>
                <th className="p-3 text-right">قیمت</th>
                <th className="p-3 text-right">مدت</th>
                <th className="p-3 text-right">پورسانت طراح</th>
                <th className="p-3 text-right">امکانات</th>
                <th className="p-3 text-right">وضعیت</th>
                <th className="p-3 text-left">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.08]">
              {plans.map((plan, index) => (
                <tr key={plan.id} className="align-top">
                  <td className="p-3">
                    <p className="flex items-center gap-1.5 font-bold text-white">
                      {plan.name}
                      {plan.is_featured && <Star className="h-3.5 w-3.5 text-amber-300" />}
                    </p>
                    {plan.slug && <p className="text-[10px] text-slate-500" dir="ltr">{plan.slug}</p>}
                  </td>
                  <td className="p-3 text-slate-300">{toman(plan.price)}</td>
                  <td className="p-3 text-slate-400">{plan.duration_days} روز</td>
                  <td className="p-3 text-slate-300">
                    {plan.commission_percent ? (
                      <span className="font-semibold text-emerald-300">{plan.commission_percent}٪</span>
                    ) : (
                      <span className="text-slate-500">بدون پورسانت</span>
                    )}
                  </td>
                  <td className="p-3">
                    {editingId === plan.id ? (
                      <div className="min-w-[280px] space-y-2">
                        <label className="block text-[10px] font-black text-slate-500">
                          قیمت (تومان)
                          <input
                            type="number"
                            min="0"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-xs text-white"
                          />
                        </label>
                        <label className="block text-[10px] font-black text-slate-500">
                          پورسانت طراح (٪)
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={editCommission}
                            onChange={(e) => setEditCommission(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-xs text-white"
                          />
                        </label>
                        {grouped.map(([group, entries]) => (
                          <div key={group}>
                            <p className="mb-1 text-[10px] font-black text-slate-500">{group}</p>
                            <div className="space-y-1.5">
                              {entries.map((entry) => (
                                <FeatureField
                                  key={entry.key}
                                  entry={entry}
                                  value={editFeatures[entry.key] ?? entry.free_value}
                                  onChange={(next) => setEditFeatures((f) => ({ ...f, [entry.key]: next }))}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void saveFeatures(plan)} className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-bold text-slate-950">ذخیره</button>
                          <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300">انصراف</button>
                        </div>
                        <p className="text-[10px] leading-4 text-amber-300/80">
                          تغییرات فقط برای خریداران جدید اعمال می‌شود؛ اشتراک‌های فعال snapshot خود را نگه می‌دارند.
                        </p>
                      </div>
                    ) : (
                      <button type="button" onClick={() => void startEdit(plan)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10">ویرایش قیمت و امکانات</button>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col gap-1 text-xs">
                      {plan.is_active ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />فعال</span>
                      ) : (
                        <span className="text-slate-500">غیرفعال</span>
                      )}
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        {plan.is_public ? <><Eye className="h-3.5 w-3.5" />عمومی</> : <><EyeOff className="h-3.5 w-3.5" />پنهان</>}
                      </span>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => void move(plan, -1)} disabled={index === 0} title="بالا" className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10 disabled:opacity-30"><TrendingUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void move(plan, 1)} disabled={index === plans.length - 1} title="پایین" className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10 disabled:opacity-30"><TrendingDown className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void patch(plan, { is_public: !plan.is_public })} title={plan.is_public ? "پنهان از صفحه قیمت" : "نمایش در صفحه قیمت"} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10">
                        {plan.is_public ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => void patch(plan, { is_featured: !plan.is_featured })} title="پیشنهاد ویژه" className="rounded-lg border border-white/10 p-2 text-amber-300 hover:bg-amber-400/10"><Star className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void toggleActive(plan)} title="تغییر وضعیت" className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10"><Power className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-5 text-slate-500">
        راهنما: غیرفعال‌کردن پلن فقط خرید جدید را مسدود می‌کند و اشتراک‌های فعال معتبر می‌مانند. قیمت‌های snapshot‌شده در اشتراک‌های گذشته با تغییر قیمت به‌روزرسانی نمی‌شوند. حذف پلن فقط برای پلن‌های بدون سابقه اشتراک ممکن است.
      </p>
    </div>
  );
}
