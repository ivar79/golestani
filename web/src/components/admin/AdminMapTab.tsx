"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Check, Database, Gauge, Globe2, RefreshCw, Save, Server } from "lucide-react";
import api from "@/lib/api";
import { getAdminSettings, saveAdminSetting } from "@/lib/admin";
import type { MapSourceMode } from "@/lib/mapSource";

/**
 * AdminMapTab — task 12: map infrastructure tab in the admin panel.
 *
 *  - three-state tile source switcher (online raster / local MBTiles / auto)
 *    persisted via the existing admin settings API (key `map.tile_source`)
 *  - live probe tools: sample-tile ping through BOTH the Laravel vector
 *    endpoint and the Next.js raster proxy, with measured latency and the
 *    `X-Tile-Source` response header
 *  - MBTiles archive status (presence, size, schema, zoom range, bounds)
 *    from GET /api/map/status (cached 60s server-side)
 */

type MapStatus = {
  mbtiles_present?: boolean;
  reason?: string;
  path?: string;
  size_bytes?: number;
  vector_schema?: string | null;
  format?: string | null;
  min_zoom?: number | null;
  max_zoom?: number | null;
  bounds?: string | null;
  center?: string | null;
  sample_tile_ok?: boolean;
  sample_tile_ms?: number;
};

type PingResult = {
  ms: number;
  ok: boolean;
  sourceHeader?: string | null;
  size?: number;
  error?: string;
};

const SOURCE_OPTIONS: Array<{ key: MapSourceMode; label: string; hint: string }> = [
  { key: "auto", label: "خودکار", hint: "تشخیص خودکار بر اساس اتصال و دسترسی به آرشیو" },
  { key: "local", label: "آفلاین محلی (MBTiles)", hint: "تایل‌های وکتوری Shortbread از آرشیو روی سرور API" },
  { key: "online", label: "آنلاین (پروکسی رستری)", hint: "کاشی‌های شطرنجی OSM از طریق پروکسی PHP سرور API" },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toLocaleString("fa-IR", { maximumFractionDigits: 2 })} گیگابایت`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`;
}

export default function AdminMapTab() {
  const [sourceMode, setSourceMode] = useState<MapSourceMode>("auto");
  const [savedMode, setSavedMode] = useState<MapSourceMode>("auto");
  const [status, setStatus] = useState<MapStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [vectorPing, setVectorPing] = useState<PingResult | null>(null);
  const [proxyPing, setProxyPing] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const rows = await getAdminSettings();
      const row = rows.find((r) => r.key === "map.tile_source");
      const value = (row?.value ?? "auto") as MapSourceMode;
      const valid = SOURCE_OPTIONS.some((o) => o.key === value) ? value : "auto";
      setSourceMode(valid);
      setSavedMode(valid);
    } catch {
      // Settings API hiccup — keep default; the status probe still works.
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const res = await api.get<MapStatus>("/map/status");
      setStatus(res.data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "خطا در دریافت وضعیت تایل‌سرور";
      setStatusError(msg);
      setStatus({ mbtiles_present: false, reason: msg });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Defer the initial loads out of the effect body (react-hooks
  // set-state-in-effect rule): the fetches themselves are async callbacks,
  // their setState calls land in microtasks after mount.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadSettings();
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadSettings, loadStatus]);

  async function save() {
    setSaving(true);
    try {
      await saveAdminSetting("map.tile_source", sourceMode);
      setSavedMode(sourceMode);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  /** Fetch one real Tehran tile through a given URL and measure latency. */
  async function pingTile(url: string, withSourceHeader: boolean): Promise<PingResult> {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { cache: "no-store" });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
      const blob = await res.blob();
      return {
        ok: true,
        ms,
        size: blob.size,
        sourceHeader: withSourceHeader ? res.headers.get("X-Tile-Source") : null,
      };
    } catch (e: unknown) {
      return {
        ok: false,
        ms: Math.round(performance.now() - t0),
        error: e instanceof Error ? e.message : "network error",
      };
    }
  }

  async function runPings() {
    setPinging(true);
    setVectorPing(null);
    setProxyPing(null);
    try {
      // z10 Tehran tile (658/403) on both transports.
      setVectorPing(await pingTile(`${api.getUri()}/map/tile/10/658/403`, true));
      setProxyPing(await pingTile(`${api.getUri()}/map/raster-tile/10/658/403`, true));
    } finally {
      setPinging(false);
    }
  }

  const dirty = sourceMode !== savedMode;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
          زیرساخت نقشه و تایل‌سرور
        </h2>
        <p className="text-xs sm:text-sm text-slate-400">
          انتخاب منبع کاشی‌های نقشه، پایش سلامت آرشیو MBTiles و تست زنده تایل‌سرور
        </p>
      </div>

      {/* Source switcher */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-400">
            <Globe2 className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold text-white">منبع تایل نقشه</h3>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          {SOURCE_OPTIONS.map((opt) => {
            const active = sourceMode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSourceMode(opt.key)}
                className={`rounded-xl border p-3.5 text-right transition-all ${
                  active
                    ? "border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_18px_rgba(34,211,238,0.2)]"
                    : "border-white/10 bg-white/[0.03] hover:border-cyan-400/30 hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className={`text-sm font-bold ${active ? "text-cyan-200" : "text-slate-200"}`}>
                    {opt.label}
                  </span>
                  {active && <Check className="h-4 w-4 text-cyan-300" />}
                </span>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-400">
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-4">
          <p className="text-[11px] text-slate-500">
            {savedMode === "auto"
              ? "حالت فعلی: خودکار — نقشه با روشن شدن، دسترسی به آرشیو را می‌سنجد و در نبود آن به منبع آنلاین سقوط می‌کند."
              : savedMode === "local"
                ? "حالت فعلی: آفلاین محلی — تایل‌ها فقط از آرشیو MBTiles روی سرور API خوانده می‌شوند."
                : "حالت فعلی: آنلاین — کاشی‌های شطرنجی از پروکسی داخلی سرو می‌شوند."}
          </p>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-5 py-2 text-xs font-bold text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "در حال ذخیره…" : "ذخیره تنظیمات"}
          </button>
        </div>
        {savedFlash && (
          <p className="mt-2 text-[11px] font-semibold text-emerald-300" role="status">
            ✓ منبع نقشه ذخیره شد.
          </p>
        )}
      </div>

      {/* MBTiles status */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-400/30 bg-indigo-500/10 text-indigo-300">
              <Database className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold text-white">وضعیت آرشیو MBTiles (سمت API)</h3>
          </div>
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loadingStatus}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loadingStatus ? "animate-spin" : ""}`} />
            بروزرسانی
          </button>
        </div>

        {status?.mbtiles_present ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="وضعیت" value="فعال و سالم" tone="ok" />
            <StatTile label="حجم آرشیو" value={formatBytes(status.size_bytes ?? 0)} />
            <StatTile label="اسکیمای وکتوری" value={status.vector_schema ?? "Shortbread"} />
            <StatTile
              label="بازه زوم"
              value={`${(status.min_zoom ?? 0).toLocaleString("fa-IR")} تا ${(status.max_zoom ?? 14).toLocaleString("fa-IR")}`}
            />
            <StatTile label="فرمت تایل" value={status.format ?? "pbf (وکتور)"} />
            <StatTile label="مختصات مرکز" value={status.center ?? "—"} tone="mono" />
            <StatTile label="محدوده جغرافیایی" value={status.bounds ?? "—"} tone="mono" />
            <StatTile
              label="پینگ تایل نمونه (سمت سرور)"
              value={status.sample_tile_ok ? `${status.sample_tile_ms?.toLocaleString("fa-IR")} میلی‌ثانیه` : "ناموفق"}
              tone={status.sample_tile_ok ? "ok" : "bad"}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-200">
            <p className="font-bold">آرشیو MBTiles روی سرور API در دسترس نیست.</p>
            <p className="mt-1 text-amber-200/80">
              {status?.reason ?? "متغیر محیطی MBTILES_PATH تنظیم نشده یا فایل روی Volume سرور قرار ندارد."}
            </p>
            <p className="mt-2 text-amber-200/80">
              راه‌اندازی: یک Volume روی Railway به سرویس API وصل کنید (مونت‌پوینت
              <code className="mx-1 rounded bg-black/30 px-1 font-mono" dir="ltr">/data</code>
              )، فایل
              <code className="mx-1 rounded bg-black/30 px-1 font-mono" dir="ltr">iran-shortbread-1.0.mbtiles</code>
              را داخل آن بگذارید و متغیر
              <code className="mx-1 rounded bg-black/30 px-1 font-mono" dir="ltr">MBTILES_PATH</code>
              را تنظیم کنید. تا آن زمان نقشه به‌صورت خودکار از منبع آنلاین استفاده می‌کند.
            </p>
          </div>
        )}
      </div>

      {/* Live probe */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
              <Activity className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold text-white">ابزار تست زنده تایل‌سرور</h3>
          </div>
          <button
            type="button"
            onClick={() => void runPings()}
            disabled={pinging}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-1.5 text-[11px] font-bold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Gauge className={`h-3.5 w-3.5 ${pinging ? "animate-pulse" : ""}`} />
            {pinging ? "در حال تست…" : "اجرای تست پینگ"}
          </button>
        </div>

        <p className="mb-3 text-[11px] text-slate-500">
          یک تایل واقعی تهران (زوم ۱۰) از هر دو مسیر سرو می‌گیرد و زمان پاسخ اندازه‌گیری می‌شود.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <PingCard
            title="وکتور محلی (Laravel + MBTiles)"
            icon={<Server className="h-3.5 w-3.5" />}
            result={vectorPing}
          />
          <PingCard
            title="پروکسی رستری (Laravel → OSM)"
            icon={<Globe2 className="h-3.5 w-3.5" />}
            result={proxyPing}
          />
        </div>
      </div>

      {statusError && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          {statusError}
        </p>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "bad" | "mono";
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xs font-bold ${
          tone === "ok"
            ? "text-emerald-300"
            : tone === "bad"
              ? "text-rose-300"
              : tone === "mono"
                ? "font-mono text-[10px] text-slate-300"
                : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PingCard({
  title,
  icon,
  result,
}: {
  title: string;
  icon: React.ReactNode;
  result: PingResult | null;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
        {icon}
        <span>{title}</span>
      </div>
      {result == null ? (
        <p className="mt-2 text-[11px] text-slate-500">هنوز تستی اجرا نشده است.</p>
      ) : result.ok ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-bold text-emerald-300">
            ✓ موفق — {result.ms.toLocaleString("fa-IR")} میلی‌ثانیه
          </p>
          <p className="text-[10px] text-slate-500">
            حجم پاسخ: {formatBytes(result.size ?? 0)}
            {result.sourceHeader ? ` · منبع: ${result.sourceHeader}` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] font-bold text-rose-300">
          ✕ ناموفق ({result.error ?? "خطای شبکه"}) — {result.ms.toLocaleString("fa-IR")} میلی‌ثانیه
        </p>
      )}
    </div>
  );
}
