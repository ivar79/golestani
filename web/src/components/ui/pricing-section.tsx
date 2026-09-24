"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, CheckCheck, CreditCard, FileText, Loader2, UploadCloud, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { getOwnedBusinesses, type Phase2Business } from "@/lib/phase2";
import { getPlansPricing, submitSubscription, type Plan } from "@/lib/subscriptions";
import { planFeatureLines, type PublicPlansResponse } from "@/lib/entitlements";
import { VerticalCutReveal } from "@/components/ui/vertical-cut-reveal";

export interface PricingContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  featuresTitle: string;
  features: string[];
  updatesTitle: string;
  updatesHint: string;
  updatesLabel1: string;
  updatesLabel2: string;
  licenseTitle: string;
  licenseHint: string;
  licenseLabel1: string;
  licenseLabel2: string;
  ctaLabel: string;
  plans: { personal3m: number; personalForever: number; corporate3m: number; corporateForever: number };
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (index: number) => ({ opacity: 1, y: 0, transition: { delay: index * 0.06, duration: 0.45, ease: "easeOut" as const } }),
};

const toman = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;

function PricingSwitch({ first, second, value, onChange }: { first: string; second: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
      {[{ label: first, selected: !value, next: false }, { label: second, selected: value, next: true }].map((item) => (
        <button key={item.label} type="button" aria-pressed={item.selected} onClick={() => onChange(item.next)} className={`rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${item.selected ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ReceiptModal({ plan, businesses, selectedBusiness, onBusinessChange, onClose, onSubmitted }: { plan: Plan; businesses: Phase2Business[]; selectedBusiness: string; onBusinessChange: (value: string) => void; onClose: () => void; onSubmitted: (message: string) => void }) {
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!selectedBusiness) return setError("ابتدا کسب‌وکار موردنظر را انتخاب کنید.");
    if (!reference.trim() && !file) return setError("شماره پیگیری یا فایل رسید را وارد کنید.");
    setSubmitting(true);
    setError(null);
    try {
      await submitSubscription(Number(selectedBusiness), { plan_id: plan.id, receipt_reference: reference.trim() || undefined, receipt: file });
      onSubmitted("درخواست شما ثبت شد و پس از بررسی مدیر فعال می‌شود.");
    } catch (requestError) {
      setError(extractApiError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0c1424] shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between border-b border-white/10 p-5 sm:p-6">
          <div><p className="text-xs font-semibold text-emerald-300">ثبت درخواست اشتراک</p><h2 id="receipt-title" className="mt-1 text-xl font-black text-white">{plan.name}</h2><p className="mt-1 text-xs text-slate-400">{toman(plan.price)} برای {plan.duration_days} روز</p></div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="بستن مودال"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          {error && <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm leading-6 text-rose-200">{error}</div>}
          <label className="block space-y-2 text-sm font-semibold text-slate-200">کسب‌وکار<select value={selectedBusiness} onChange={(event) => onBusinessChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"><option value="">انتخاب کسب‌وکار</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
          <label className="block space-y-2 text-sm font-semibold text-slate-200">شماره رسید یا کد پیگیری <span className="font-normal text-slate-500">(اختیاری اگر فایل انتخاب شود)</span><input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} placeholder="مثال: TRX-123456" className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400" /></label>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 text-sm text-slate-300 hover:border-emerald-400/60 hover:bg-emerald-400/[0.04]"><UploadCloud className="h-5 w-5 shrink-0 text-emerald-300" /><span className="min-w-0 flex-1 truncate">{file ? file.name : "فایل رسید را انتخاب کنید (JPG، PNG یا PDF تا ۵MB)"}</span><input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={(event) => setFile(event.target.files?.[0])} /></label>
          <div className="flex items-start gap-2 rounded-2xl bg-emerald-400/[0.06] p-3 text-xs leading-6 text-slate-400"><FileText className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />رسیدها به‌صورت دستی بررسی می‌شوند و وضعیت درخواست در داشبورد شما نمایش داده خواهد شد.</div>
          <button type="button" onClick={() => void submit()} disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3.5 text-sm font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}ثبت درخواست</button>
        </div>
      </div>
    </div>
  );
}

export default function PricingSection({ content }: { content: PricingContent }) {
  const router = useRouter();
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pricing, setPricing] = useState<PublicPlansResponse | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [isForever, setIsForever] = useState(false);
  const [isCorporate, setIsCorporate] = useState(false);
  const [modalPlan, setModalPlan] = useState<Plan | null>(null);
  const [businesses, setBusinesses] = useState<Phase2Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getPlansPricing()
        .then((payload) => { setPricing(payload); setPlans(payload.plans); })
        .catch((requestError) => setPlansError(extractApiError(requestError)))
        .finally(() => setPlansLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // NOTE (price hardcode ban): plan prices render only from API data.
  // The CMS content fallback below is display-only legacy scaffolding and
  // is no longer used for plan cards.
  void content.plans;
  const displayedPlans = plans.filter((plan) => plan.is_active);
  const currentPlan = displayedPlans.find((plan) => (isCorporate ? plan.name.toLowerCase().includes("سازمانی") || plan.name.toLowerCase().includes("corporate") : !plan.name.toLowerCase().includes("سازمانی") && !plan.name.toLowerCase().includes("corporate"))) ?? displayedPlans[0];
  const MotionDiv = reducedMotion ? "div" : motion.div;

  async function openReceipt(plan: Plan) {
    if (!user) return router.push("/login?next=/pricing");
    setSuccess(null);
    try {
      const owned = await getOwnedBusinesses();
      setBusinesses(owned);
      setSelectedBusiness(String(owned[0]?.id ?? ""));
      setModalPlan(plan);
    } catch (requestError) {
      setPlansError(extractApiError(requestError));
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-night px-4 pb-20 pt-28 text-surface sm:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(16,185,129,0.14),transparent_28%),radial-gradient(circle_at_85%_35%,rgba(34,211,238,0.10),transparent_30%)]" />
      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center"><MotionDiv variants={fadeUp} custom={0} initial="hidden" animate="visible" className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-300"><Zap className="h-4 w-4" />{content.eyebrow}</MotionDiv><h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl"><VerticalCutReveal splitBy="words" staggerDuration={0.12} staggerFrom="first" containerClassName="justify-center">{content.title}</VerticalCutReveal></h1><p className="mt-5 text-base leading-8 text-slate-400 sm:text-lg">{content.subtitle}</p></div>
        {plansError && <div role="alert" className="mx-auto mt-8 max-w-2xl rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-center text-sm text-rose-200">{plansError}<button type="button" onClick={() => window.location.reload()} className="ms-2 font-bold underline">تلاش دوباره</button></div>}
        {success && <div role="status" className="mx-auto mt-8 max-w-2xl rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-center text-sm text-emerald-200">{success}</div>}
        {/* Free tier — rendered from the server contract (config-driven). */}
        {pricing && (
          <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black text-white">{pricing.free_tier.label}</h2>
                  <p className="mt-2 text-sm text-slate-400">{pricing.free_tier.description}</p>
                </div>
                <span className="text-2xl font-black text-slate-400">۰</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                {planFeatureLines(pricing.free_tier.capabilities, pricing.labels).map((line) => (
                  <li key={line.key} className="flex gap-2">
                    {line.state === "off"
                      ? <X className="h-4 w-4 shrink-0 text-slate-600" />
                      : <Check className="h-4 w-4 shrink-0 text-emerald-300" />}
                    <span className={line.state === "off" ? "text-slate-500" : ""}>{line.label}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => router.push("/dashboard")} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-sm font-black text-white transition hover:bg-white/10">
                <CreditCard className="h-4 w-4" />
                شروع رایگان
              </button>
            </div>
          </div>
        )}

        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          {plansLoading ? <div className="col-span-full flex items-center justify-center gap-3 py-16 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-emerald-300" />در حال دریافت پلن‌ها...</div> : displayedPlans.length === 0 ? <div className="col-span-full rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center text-sm text-slate-400">در حال حاضر پلن فعالی برای نمایش وجود ندارد.</div> : displayedPlans.map((plan, index) => { const selected = currentPlan?.id === plan.id; return <MotionDiv key={plan.id} variants={fadeUp} custom={index + 1} initial="hidden" animate="visible" className={`relative rounded-3xl border p-6 transition-transform hover:-translate-y-1 ${selected ? "border-emerald-400/60 bg-emerald-400/[0.09] shadow-2xl shadow-emerald-950/40" : "border-white/10 bg-white/[0.04]"}`}>
            {(selected || plan.is_featured) && <span className="absolute -top-3 right-6 rounded-full bg-emerald-400 px-3 py-1 text-[11px] font-black text-slate-950">{plan.is_featured ? "پیشنهاد ویژه" : "پلن فعلی"}</span>}
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-black text-white">{plan.name}</h2><p className="mt-2 text-sm text-slate-400">{plan.description || `اعتبار ${plan.duration_days} روزه`}</p></div><CreditCard className="h-6 w-6 text-emerald-300" /></div><div className="mt-8 text-3xl font-black text-white">{toman(plan.price)}</div>
            {/* Feature lines come from the SERVER catalog labels — zero hardcoded feature names. */}
            <ul className="mt-6 space-y-3 text-sm text-slate-300">
              {planFeatureLines(plan.features, pricing?.labels ?? {}).filter((line) => line.state !== "off").map((line) => (
                <li key={line.key} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-300" />{line.label}</li>
              ))}
            </ul><button type="button" onClick={() => void openReceipt(plan)} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3.5 text-sm font-black text-slate-950 transition hover:bg-emerald-300"><CreditCard className="h-4 w-4" />{content.ctaLabel}</button>
          </MotionDiv>; })}
        </div>
        <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-7"><h3 className="text-lg font-bold text-white">{content.featuresTitle}</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{content.features.map((feature) => <div key={feature} className="flex items-center gap-2 text-sm text-slate-400"><CheckCheck className="h-4 w-4 text-emerald-300" />{feature}</div>)}</div><div className="mt-6 grid gap-4 sm:grid-cols-2"><div><p className="mb-2 text-xs text-slate-500">{content.updatesTitle}</p><PricingSwitch first={content.updatesLabel1} second={content.updatesLabel2} value={isForever} onChange={setIsForever} /></div><div><p className="mb-2 text-xs text-slate-500">{content.licenseTitle}</p><PricingSwitch first={content.licenseLabel1} second={content.licenseLabel2} value={isCorporate} onChange={setIsCorporate} /></div></div></div>
      </div>
      {modalPlan && <ReceiptModal plan={modalPlan} businesses={businesses} selectedBusiness={selectedBusiness} onBusinessChange={setSelectedBusiness} onClose={() => setModalPlan(null)} onSubmitted={(message) => { setModalPlan(null); setSuccess(message); }} />}
    </div>
  );
}
