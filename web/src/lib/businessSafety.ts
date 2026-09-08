/** Pure URL helpers, shared by editor and public renderer; no browser globals. */
export function safeHttpUrl(value?: string | null): string | null {
  if (!value || /[-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function resolveMediaUrl(baseURL: string, path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return safeHttpUrl(path);
  if (!path.startsWith("/storage/") || path.includes("..") || /[\\?#%]/.test(path)) return null;
  try {
    const base = new URL(baseURL);
    const prefix = base.pathname.replace(/\/api(?:\/v\d+)?\/?$/, "").replace(/\/$/, "");
    return safeHttpUrl(`${base.origin}${prefix}${path}`);
  } catch { return null; }
}
export function normalizeSocial(key: string, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (key === "whatsapp" && /^[+\d۰-۹٠-٩\s()-]+$/.test(value)) {
    let digits = value.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (/^09\d{9}$/.test(digits)) digits = "98" + digits.slice(1);
    if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("شماره واتساپ معتبر وارد کنید.");
    return `https://wa.me/${digits}`;
  }
  if (value.startsWith("//")) throw new Error("لینک باید با HTTPS یا نام دامنه شروع شود.");
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = safeHttpUrl(candidate);
  if (!url) throw new Error("لینک شبکه اجتماعی باید HTTP یا HTTPS معتبر باشد.");
  return url;
}
