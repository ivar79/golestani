"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign, Check, Loader2, Sparkles, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { checkUsername, setUsername } from "@/lib/auth";

type Remote =
  | { for: string; state: "available" }
  | { for: string; state: "taken"; suggestions: string[] }
  | { for: string; state: "error" };

type Probe =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken"; suggestions: string[] }
  | { state: "invalid"; hint: string }
  | { state: "error" };

function normalize(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, "_");
}

function validate(v: string): string | null {
  if (v.length < 3) return "حداقل ۳ کاراکتر لازم است.";
  if (v.length > 30) return "حداکثر ۳۰ کاراکتر مجاز است.";
  if (/[^a-z0-9_]/.test(v)) return "فقط حروف انگلیسی، عدد و زیرخط مجاز است.";
  if (!/^[a-z0-9]/.test(v)) return "باید با حرف یا عدد شروع شود.";
  return null;
}

/**
 * One-time card: shown in the dashboard only while the user has no username.
 * Live availability probe (debounced), duplicate handling with server
 * suggestions, and a success state that fades the card away.
 *
 * Probe status is derived during render from `value` + the last remote
 * answer, so no state is written synchronously inside the effect.
 */
export default function UsernamePicker() {
  const { user, refreshUser } = useAuth();
  const [value, setValue] = useState("");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const v = normalize(value);
  const hint = validate(v);
  const hidden = !user || !!user.username || done;

  useEffect(() => {
    if (hidden || !v || hint) return;
    let cancelled = false;
    debounce.current = setTimeout(async () => {
      try {
        const res = await checkUsername(v);
        if (!cancelled) {
          setRemote(
            res.available
              ? { for: v, state: "available" }
              : { for: v, state: "taken", suggestions: res.suggestions },
          );
        }
      } catch {
        if (!cancelled) setRemote({ for: v, state: "error" });
      }
    }, 450);
    return () => {
      cancelled = true;
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [v, hint, hidden]);

  const submit = async () => {
    if (hint || probe.state !== "available") return;
    setSaving(true);
    setError(null);
    try {
      const res = await setUsername(v);
      if (res.ok) {
        await refreshUser();
        setDone(true);
      } else {
        setRemote({ for: v, state: "taken", suggestions: res.suggestions });
        setError(res.message);
      }
    } catch {
      setError("ذخیره ناموفق بود. دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  };

  const probe: Probe = saving
    ? { state: "checking" }
    : !v
      ? { state: "idle" }
      : hint
        ? { state: "invalid", hint }
        : remote?.for !== v
          ? { state: "checking" }
          : remote.state === "available"
            ? { state: "available" }
            : remote.state === "taken"
              ? { state: "taken", suggestions: remote.suggestions }
              : { state: "error" };

  if (hidden) return null;

  const status = () => {
    switch (probe.state) {
      case "checking":
        return <Loader2 className="h-4 w-4 animate-spin text-ik-accent" />;
      case "available":
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-ik-success">
            <Check className="h-4 w-4" /> در دسترس است
          </span>
        );
      case "taken":
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-ik-danger">
            <XCircle className="h-4 w-4" /> قبلاً گرفته شده
          </span>
        );
      case "invalid":
        return <span className="text-xs text-amber-600 dark:text-amber-300">{probe.hint}</span>;
      case "error":
        return (
          <span className="text-xs text-amber-600 dark:text-amber-300">
            خطا در بررسی — دوباره تلاش کنید
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <section
      aria-label="انتخاب نام کاربری"
      className="rounded-2xl border border-ik-accent/25 bg-ik-accent/[0.07] p-5 space-y-3"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-ik-accent/30 bg-ik-accent/15">
          <AtSign className="h-4 w-4 text-ik-accent" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-ik-text">نام کاربری اختصاصی خود را انتخاب کنید</h3>
          <p className="text-[11px] text-ik-muted">
            این نام شناسه عمومی شما در اینکارت است و فقط یک‌بار قابل انتخاب است.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <AtSign className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ik-muted" />
          <input
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="مثلاً hossein_cafe"
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            aria-label="نام کاربری"
            className="w-full rounded-xl border border-ik-border bg-ik-wash py-2.5 pr-9 pl-3 text-sm text-ik-text placeholder:text-ik-muted focus:border-ik-accent/50 focus:outline-none focus:ring-2 focus:ring-ik-accent/20"
          />
        </div>
        <button
          type="button"
          disabled={saving || probe.state !== "available"}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-ik-accent px-4 py-2.5 text-xs font-bold text-ik-accent-contrast transition-colors hover:bg-ik-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          ذخیره
        </button>
        <div className="min-w-[110px]">{status()}</div>
      </div>

      {error && <p className="text-xs text-ik-danger">{error}</p>}

      {probe.state === "taken" && probe.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-ik-muted">پیشنهادهای آزاد:</span>
          {probe.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setRemote(null);
                setValue(s);
              }}
              dir="ltr"
              className="rounded-lg border border-ik-accent/30 bg-ik-accent/10 px-2.5 py-1 font-mono text-xs text-ik-accent transition-colors hover:bg-ik-accent/20"
            >
              @{s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
