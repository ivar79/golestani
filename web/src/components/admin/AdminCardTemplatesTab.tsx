"use client";

/**
 * AdminCardTemplatesTab — the admin's independent "Card Templates" section.
 *
 * Responsibilities:
 *   - moderation queue (approve/reject designer submissions with reason),
 *   - CRUD for DB templates (create with pasted design_json, metadata edit,
 *     soft-delete/archive, reorder),
 *   - template ↔ plan assignment via the STABLE plan_id pivot,
 *   - the designer-program master switch (whitelisted SiteSetting).
 *
 * NOTE: gating of BUILT-IN templates stays in the Plans tab (the
 * `card_templates` list capability); DB templates are assigned here per
 * plan. Both are capability-driven — no plan names anywhere.
 */

import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";

type TemplateRow = {
  id: number;
  slug: string;
  name_fa: string;
  category: string;
  origin: "admin" | "designer";
  status: "pending" | "approved" | "rejected" | "archived";
  rejection_reason?: string | null;
  sort_order?: number;
  deleted_at?: string | null;
  uploaded_by?: number | null;
  created_at?: string;
};

type PlanRow = { id: number; name: string; slug: string };

const STATUS_LABELS: Record<TemplateRow["status"], string> = {
  pending: "در انتظار تأیید",
  approved: "تأییدشده",
  rejected: "ردشده",
  archived: "آرشیو",
};

const STATUS_STYLES: Record<TemplateRow["status"], string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-400/30",
  archived: "bg-slate-500/15 text-slate-300 border-slate-400/30",
};

export default function AdminCardTemplatesTab() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});
  const [originFilter, setOriginFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [programEnabled, setProgramEnabled] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [newSlug, setNewSlug] = useState("");
  const [newJson, setNewJson] = useState("");
  const [newPlans, setNewPlans] = useState<number[]>([]);
  const [rejectForId, setRejectForId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params: Record<string, string> = {};
      if (originFilter) params.origin = originFilter;
      if (statusFilter) params.status = statusFilter;
      if (query) params.q = query;
      const [templatesRes, plansRes] = await Promise.all([
        api.get("/admin/templates", { params }),
        api.get("/admin/plans"),
      ]);
      const templateRows: TemplateRow[] = templatesRes.data.templates ?? [];
      setTemplates(templateRows);
      const planRows: PlanRow[] = plansRes.data.plans ?? plansRes.data ?? [];
      setPlans(planRows);

      // Read each visible template's REAL plan assignments from the pivot.
      const nextAssignments: Record<number, number[]> = {};
      await Promise.all(
        templateRows.slice(0, 50).map(async (t) => {
          try {
            const res = await api.get(`/admin/templates/${t.id}/plans`);
            nextAssignments[t.id] = (res.data.plan_ids ?? []).map((n: number) => Number(n));
          } catch {
            nextAssignments[t.id] = [];
          }
        }),
      );
      setAssignments(nextAssignments);
    } catch {
      setMessage("بارگذاری قالب‌ها ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }, [originFilter, statusFilter, query]);

  // Initial + filter-driven load — deferred to a macrotask (the established
  // AdminPlansTab pattern) so state is never set synchronously in the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Designer program master switch (whitelisted setting) — loaded through
  // the same fetch-and-set pattern as `load` (state updates happen in the
  // promise callbacks, never synchronously during render/effect).
  const loadProgramFlag = useCallback(async () => {
    try {
      const res = await api.get("/admin/settings");
      const row = (res.data ?? []).find((s: { key: string; value: string | null }) => s.key === "designer_program_enabled");
      setProgramEnabled(row?.value === "1");
    } catch {
      setProgramEnabled(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProgramFlag(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProgramFlag]);

  const toggleProgram = async () => {
    const next = !(programEnabled ?? false);
    setBusy(true);
    try {
      await api.put(`/admin/settings/designer_program_enabled`, { value: next });
      setProgramEnabled(next);
      setMessage(next ? "برنامه طراحان فعال شد." : "برنامه طراحان غیرفعال شد.");
    } catch {
      setMessage("تغییر وضعیت برنامه ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const moderate = async (template: TemplateRow, action: "approve" | "reject" | "archive") => {
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/admin/templates/${template.id}/moderate`, {
        action,
        reason: action === "reject" ? rejectReason || undefined : undefined,
      });
      if (action === "reject") {
        setRejectForId(null);
        setRejectReason("");
      }
      setMessage(
        action === "approve"
          ? "قالب تأیید و به گالری اضافه شد."
          : action === "reject"
            ? "قالب رد شد."
            : "قالب آرشیو شد.",
      );
      await load();
    } catch {
      setMessage("عملیات ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const updatePlans = async (template: TemplateRow, planIds: number[]) => {
    setAssignments((prev) => ({ ...prev, [template.id]: planIds }));
    setBusy(true);
    try {
      await api.put(`/admin/templates/${template.id}`, { plan_ids: planIds });
      setMessage("انتساب پلن‌ها ذخیره شد.");
    } catch {
      setMessage("ذخیره انتساب ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const createTemplate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const design = JSON.parse(newJson);
      await api.post("/admin/templates", {
        name_fa: newName,
        slug: newSlug || undefined,
        category: newCategory,
        design_json: design,
        plan_ids: newPlans,
      });
      setCreating(false);
      setNewName("");
      setNewSlug("");
      setNewJson("");
      setNewPlans([]);
      setMessage("قالب ساخته و منتشر شد.");
      await load();
    } catch (e) {
      const msg = e instanceof SyntaxError ? "JSON نامعتبر است." : "ساخت قالب ناموفق بود.";
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (template: TemplateRow) => {
    if (!window.confirm(`حذف «${template.name_fa}»؟ (حذف نرم — کارت‌های اعمال‌شده سالم می‌مانند)`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/templates/${template.id}`);
      setMessage("قالب حذف شد (soft).");
      await load();
    } catch {
      setMessage("حذف ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Designer program switch */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <h3 className="text-sm font-bold text-white">برنامه طراحان</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            خاموش‌کردن، درخواست‌های جدید و ثبت قالب را می‌بندد؛ وضعیت‌های قبلی حفظ می‌شود.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || programEnabled === null}
          onClick={toggleProgram}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            programEnabled
              ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
              : "bg-slate-600/30 text-slate-300 hover:bg-slate-600/50"
          }`}
        >
          {programEnabled ? "فعال ✓" : "غیرفعال"}
        </button>
      </div>

      {/* Filters + create */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجو (نام یا اسلاگ)…"
          className="w-44 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs text-white"
        />
        <select
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-xs text-white"
        >
          <option value="">همه منشأها</option>
          <option value="admin">ادمین</option>
          <option value="designer">طراح</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-xs text-white"
        >
          <option value="">همه وضعیت‌ها</option>
          <option value="pending">در انتظار تأیید</option>
          <option value="approved">تأییدشده</option>
          <option value="rejected">ردشده</option>
          <option value="archived">آرشیو</option>
        </select>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="ms-auto rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400"
        >
          {creating ? "بستن فرم" : "+ قالب جدید"}
        </button>
      </div>

      {message && (
        <p className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200">{message}</p>
      )}

      {/* Create form */}
      {creating && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="نام قالب (فارسی)"
              className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
            />
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="اسلاگ لاتین (اختیاری)"
              dir="ltr"
              className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
            />
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="دسته‌بندی"
              className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
            />
          </div>
          <textarea
            value={newJson}
            onChange={(e) => setNewJson(e.target.value)}
            placeholder='{"version":1,"artboard":{…},"background":"…","layers":[…]}'
            dir="ltr"
            rows={8}
            className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 font-mono text-[11px] text-white"
          />
          <div>
            <p className="mb-1 text-[11px] text-slate-400">پلن‌های مجاز (pivot با plan_id):</p>
            <div className="flex flex-wrap gap-2">
              {plans.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={newPlans.includes(p.id)}
                    onChange={(e) =>
                      setNewPlans((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))
                    }
                    className="h-3.5 w-3.5 accent-cyan-400"
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={busy || !newName || !newJson}
            onClick={createTemplate}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            انتشار قالب
          </button>
        </div>
      )}

      {/* Templates table */}
      <div className="space-y-2.5">
        {templates.map((t) => (
          <div key={t.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-white">{t.name_fa}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${STATUS_STYLES[t.status]}`}>
                {STATUS_LABELS[t.status]}
              </span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-300">
                {t.origin === "designer" ? "اثر طراح" : "ادمین"}
              </span>
              <span dir="ltr" className="text-[10px] text-slate-500">{t.slug}</span>
              {t.deleted_at && <span className="text-[9px] text-rose-400">(حذف‌شده)</span>}
            </div>

            {t.status === "rejected" && t.rejection_reason && (
              <p className="mt-1 text-[11px] text-rose-300">دلیل رد: {t.rejection_reason}</p>
            )}

            {t.status === "pending" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => moderate(t, "approve")}
                  className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                >
                  تأیید و انتشار
                </button>
                {rejectForId === t.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="دلیل رد…"
                      className="w-40 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-[11px] text-white"
                    />
                    <button
                      type="button"
                      disabled={busy || !rejectReason}
                      onClick={() => moderate(t, "reject")}
                      className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-[11px] font-bold text-rose-300 disabled:opacity-50"
                    >
                      ثبت رد
                    </button>
                    <button type="button" onClick={() => setRejectForId(null)} className="text-[11px] text-slate-400">
                      انصراف
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRejectForId(t.id);
                      setRejectReason("");
                    }}
                    className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20"
                  >
                    رد با دلیل
                  </button>
                )}
              </div>
            )}

            {(t.status === "approved" || t.status === "archived") && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-400">پلن‌ها:</span>
                {plans.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={(assignments[t.id] ?? []).includes(p.id)}
                      onChange={(e) =>
                        updatePlans(
                          t,
                          e.target.checked
                            ? [...(assignments[t.id] ?? []), p.id]
                            : (assignments[t.id] ?? []).filter((x) => x !== p.id),
                        )
                      }
                      className="h-3.5 w-3.5 accent-cyan-400"
                    />
                    {p.name}
                  </label>
                ))}
                {t.status === "approved" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => moderate(t, "archive")}
                    className="ms-auto rounded-lg bg-slate-600/30 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-600/50"
                  >
                    آرشیو
                  </button>
                )}
                {t.status === "archived" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => moderate(t, "approve")}
                    className="ms-auto rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300"
                  >
                    بازگشت به گالری
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => destroy(t)}
                  className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20"
                >
                  حذف
                </button>
              </div>
            )}
          </div>
        ))}
        {templates.length === 0 && !busy && (
          <p className="py-6 text-center text-xs text-slate-500">قالبی با این فیلترها نیست.</p>
        )}
      </div>

      <p className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[10px] leading-4 text-slate-500">
        راهنما: گیت قالب‌های داخلی (بیلت‌این) از تب «پلن‌ها و درآمد» با لیست قالب‌های کارت (card templates) مدیریت می‌شود؛ انتساب قالب‌های دیتابیسی از همین تب و با شناسه پایدار پلن (plan_id) انجام می‌شود — تغییر نام پلن هرگز انتساب‌ها را نمی‌شکند.
      </p>
    </div>
  );
}
