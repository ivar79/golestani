"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { searchIranLocations } from "@/lib/iranGeo";
import { neshanSearchAvailable, searchNeshanAddress, type NeshanPlace } from "@/lib/neshanSearch";

/**
 * LocationSearch — جست‌وجوی شهر/آدرس برای تب «موقعیت روی نقشه» داشبورد.
 *
 * الگوی استاندارد انتخاب موقعیت (Google Business Profile / Snapp):
 *   1. جست‌وجوی آدرس (این کامپوننت) → پرش نقشه به نقطهٔ انتخابی
 *   2. GPS (دکمهٔ کناری در صفحه)
 *   3. کلیک/تنظیم دقیق پین روی نقشه
 *
 * دو منبع نتیجه:
 *   - Neshan geocoding (وقتی کلید NEXT_PUBLIC_NESHAN_MAP_KEY موجود است) —
 *     مختصات دقیق واقعی شهر/آدرس.
 *   - دیتاست آفلاین iranGeo (fallback همیشه‌در‌دسترس) — مختصات مرکز استان؛
 *     تنظیم دقیق نهایی با پین نقشه انجام می‌شود.
 *
 * قرارداد شکست هم‌قرارداد با neshanSearch.ts است: هیچ مسیر خطایی crash
 * ایجاد نمی‌کند؛ فقط پیام راهنما و ادامهٔ جریان دستی.
 */

export type LocationSearchResult = {
  lat: number;
  lng: number;
  /** برچسب نمایشی نتیجه (مثلاً «شاهین‌شهر، استان اصفهان»). */
  label: string;
  /** نام شهر/شهرستان برای پرکردن خودکار فیلد «شهر» فرم (وقتی قابل تشخیص است). */
  city?: string;
};

type Row = {
  key: string;
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  city?: string;
};

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;
const MAX_ROWS = 6;

function normalizeWs(s: string): string {
  return s.replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
}

export default function LocationSearch({
  onSelect,
  disabled = false,
}: {
  onSelect: (result: LocationSearchResult) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  // Last scheduled search id that has NOT landed yet. Both state updates
  // happen inside async callbacks only (react-hooks/set-state-in-effect
  // forbids setState in the effect body); `searching` derives from them.
  const [inflightSeq, setInflightSeq] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Debounced live search: ≥ MIN_CHARS chars, 300ms after the last keystroke.
  // No setState in the effect body: `rows` is cleared during render (the
  // derived pattern below) and `inflightSeq` is updated inside the async
  // debounce callback. `unavailable` intentionally persists between
  // keystrokes so the offline notice does not flash on and off.
  const tooShort = normalizeWs(query).length < MIN_CHARS;
  const requestedSeq = seqRef.current;
  useEffect(() => {
    if (tooShort) return;
    const q = normalizeWs(query);
    const seq = ++seqRef.current;
    const timer = window.setTimeout(async () => {
      const merged = await runSearch(q);
      // Stale response (a newer keystroke started later) — discard silently.
      if (seq !== seqRef.current) return;
      setRows(merged);
      if (inflightSeq === seq) setInflightSeq(null);
      setOpen(true);
    }, DEBOUNCE_MS);
    if (inflightSeq !== seq) setInflightSeq(seq);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runSearch is stable per-mount (module helpers + setState)
  }, [query, tooShort]);

  /** Neshan first; offline Iran dataset as fallback when empty/unavailable. */
  async function runSearch(q: string): Promise<Row[]> {
    const rows: Row[] = [];

    if (neshanSearchAvailable()) {
      const places = await searchNeshanAddress(q);
      if (places === null) {
        // Network failure / timeout — mark the service unavailable but the
        // offline dataset below still answers.
        setUnavailable(true);
      } else {
        setUnavailable(false);
        for (const p of places) rows.push(toRow(p));
      }
    }

    if (rows.length === 0) {
      // Offline fallback (no key, no network, or no Neshan hits):
      // nationwide province/city dataset — coordinates are the province
      // center; the user fine-tunes with the map pin afterwards.
      for (const m of searchIranLocations(q, MAX_ROWS)) {
        rows.push({
          key: `offline-${m.name}-${m.province}`,
          lat: m.lat,
          lng: m.lng,
          title: m.name,
          subtitle: `استان ${m.province}`,
          city: m.name,
        });
      }
    }

    return rows.slice(0, MAX_ROWS);
  }

  function toRow(p: NeshanPlace): Row {
    const subtitle = [p.neighbourhood, p.city, p.province].filter(Boolean).join("، ");
    return {
      key: `neshan-${p.lat}-${p.lng}-${p.title}`,
      lat: p.lat,
      lng: p.lng,
      title: p.title,
      subtitle: subtitle ? `${subtitle} — استان ${p.province ?? "نامشخص"}`.replace(" — استان نامشخص", "") : "نشان",
      city: p.city ?? undefined,
    };
  }

  function pick(row: Row) {
    onSelect({
      lat: row.lat,
      lng: row.lng,
      label: row.subtitle ? `${row.title}، ${row.subtitle}` : row.title,
      city: row.city,
    });
    setQuery("");
    setRows(null);
    setOpen(false);
  }

  // Derived busy state: the newest scheduled search (this render's seq) has
  // not landed yet — either the debounce is counting down or the request is
  // in flight. `requestedSeq` tracks the effect schedule without setState.
  const searching = !tooShort && inflightSeq === requestedSeq && requestedSeq > 0;

  return (
    <div ref={rootRef} className="relative w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Enter submits immediately (the debounce effect also covers it).
          const q = normalizeWs(query);
          if (q.length >= MIN_CHARS) {
            const seq = ++seqRef.current;
            setInflightSeq(seq);
            void runSearch(q).then((merged) => {
              if (seq !== seqRef.current) return;
              setRows(merged);
              if (inflightSeq === seq) setInflightSeq(null);
              setOpen(true);
            });
          }
        }}
        className="flex items-stretch gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ik-muted" />
          <input
            type="text"
            dir="rtl"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => rows && rows.length > 0 && setOpen(true)}
            placeholder="جست‌وجوی شهر یا آدرس… (مثلاً شاهین‌شهر)"
            aria-label="جست‌وجوی شهر یا آدرس برای تعیین موقعیت"
            className="ik-field w-full rounded-xl border border-ik-border bg-ik-wash py-2.5 pr-9 pl-3 text-sm text-ik-text outline-none transition-colors placeholder:text-ik-muted focus:border-ik-accent disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || searching || normalizeWs(query).length < MIN_CHARS}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ik-accent/30 bg-ik-accent/10 px-4 py-2 text-xs font-semibold text-ik-accent transition-colors hover:bg-ik-accent/20 disabled:opacity-50"
          title="جست‌وجو"
        >
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}
          <span>{searching ? "در حال جست‌وجو…" : "جست‌وجو"}</span>
        </button>
      </form>

      {unavailable && (
        <p className="mt-1.5 px-1 text-[11px] text-amber-600">
          آدرس‌یاب آنلاین در دسترس نیست — نتایج آفلاین (مرکز استان) نشان داده می‌شود؛ دقیق‌سازی با پین نقشه.
        </p>
      )}

      {open && rows && (
        <div
          dir="rtl"
          className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-ik-border bg-ik-panel shadow-xl backdrop-blur-xl"
        >
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-xs text-ik-muted">
              موردی پیدا نشد — مکان را دستی روی نقشه انتخاب کنید.
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto py-1">
              {rows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="flex w-full flex-col items-start px-4 py-2 text-right transition-colors hover:bg-ik-accent/10"
                  >
                    <span className="text-sm font-medium text-ik-text">{r.title}</span>
                    {r.subtitle && <span className="text-[11px] text-ik-muted">{r.subtitle}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
